import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  InputRenderable,
  type SelectOption,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, saveConfig, resolvePath, ensureDir } from "../lib/config"
import { scanForGgufFiles, formatFileSize, getGgufLayerCount } from "../lib/file_utils"
import { runProcess } from "../lib/process_runner"
import { createProcessPanel } from "./components/process_panel"
import { QUANT_TYPES } from "../types"
import * as path from "path"
import * as fs from "fs"

type FocusedField = "file" | "quant" | "output" | "prune"

interface PruneValidation {
  layers: string[]
  valid: boolean
  message: string
}

function formatTier(tier: string): string {
  return tier.replace(/^\w/, (c) => c.toUpperCase())
}

function parsePruneLayers(value: string, layerCount: number | null): PruneValidation {
  const rawLayers = value.split(",").map((s) => s.trim()).filter(Boolean)
  if (rawLayers.length === 0) {
    return { layers: [], valid: true, message: "No layers selected for pruning" }
  }

  const invalidToken = rawLayers.find((s) => !/^\d+$/.test(s))
  if (invalidToken) {
    return { layers: rawLayers, valid: false, message: `Invalid layer: ${invalidToken} must be an integer` }
  }

  const layerNums = rawLayers.map((s) => Number(s))
  if (layerCount !== null) {
    const invalid = layerNums.filter((n) => n < 0 || n >= layerCount)
    if (invalid.length > 0) {
      return {
        layers: rawLayers,
        valid: false,
        message: `Invalid layer(s): ${invalid.join(", ")}. Valid range: 0-${layerCount - 1}`,
      }
    }
  }

  const unique = new Set(layerNums)
  if (unique.size !== layerNums.length) {
    return { layers: rawLayers, valid: false, message: "Duplicate layer numbers detected" }
  }

  return {
    layers: rawLayers,
    valid: true,
    message: `${rawLayers.length} layer${rawLayers.length === 1 ? "" : "s"} selected for pruning`,
  }
}

function getFailureHints(result: { exitCode: number | null; stderr: string }, cmd: string): string[] {
  const text = result.stderr.toLowerCase()
  const hints: string[] = []

  if (result.exitCode === -1 || text.includes("enoent") || text.includes("not found") || text.includes("cannot find")) {
    hints.push(`Could not start ${path.basename(cmd)}. Check Setup or Settings for the llama.cpp path.`)
  }
  if (text.includes("permission") || text.includes("access is denied")) {
    hints.push("Permission denied. Check that the output file is not open and the output directory is writable.")
  }
  if (text.includes("invalid") && text.includes("quant")) {
    hints.push("The selected quantization type may not be supported by this llama.cpp build.")
  }
  if (text.includes("no such file") || text.includes("cannot open")) {
    hints.push("A path could not be opened. Check the input model and output directory paths.")
  }
  if (hints.length === 0 && result.exitCode !== 0) {
    hints.push("Check the output above for the llama-quantize error details.")
  }

  return hints
}

export function createQuantizeScreen(renderer: CliRenderer): BoxRenderable {
  const ctx = renderer
  const config = loadConfig()
  const compactLayout = renderer.height < 32
  const fileListHeight = compactLayout ? 4 : 7
  const quantListHeight = compactLayout ? 5 : 7

  const container = new BoxRenderable(ctx, {
    id: "quantize-screen",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    padding: 1,
  })

  const header = new BoxRenderable(ctx, {
    id: "quantize-header",
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    height: 1,
  })
  container.add(header)

  const title = new TextRenderable(ctx, {
    id: "quantize-title",
    content: "=== Quantize GGUF Model ===",
    fg: "cyan",
  })
  header.add(title)

  const columnHint = new TextRenderable(ctx, {
    id: "quantize-column-hint",
    content: "Layers: reading...",
    fg: "gray",
  })
  header.add(columnHint)

  const files = scanForGgufFiles(config.sourceModelsDir)

  if (files.length === 0) {
    const onKey = (key: any) => {
      if (key.name === "escape") popScreen()
    }
    renderer.keyInput.on("keypress", onKey)
    setCleanup(() => renderer.keyInput.off("keypress", onKey))

    const noFiles = new TextRenderable(ctx, {
      id: "no-gguf",
      content: "No GGUF files found in source_models/",
      fg: "yellow",
    })
    container.add(noFiles)

    const hintText = new TextRenderable(ctx, {
      id: "quantize-hint",
      content: "Esc: back",
      fg: "gray",
    })
    container.add(hintText)

    return container
  }

  const fileLabel = new TextRenderable(ctx, {
    id: "file-label",
    content: "Select source GGUF file:",
    fg: "white",
    height: 1,
  })
  container.add(fileLabel)

  const fileOptions: SelectOption[] = files.map((f) => ({
    name: f.name,
    description: compactLayout ? formatFileSize(f.size) : `${f.path} (${formatFileSize(f.size)})`,
    value: f.path,
  }))
  const initialFileIndex = Math.max(0, files.findIndex((f) => f.path === config.lastQuantSource))

  const fileSelect = new SelectRenderable(ctx, {
    id: "file-select",
    height: Math.min(Math.max(fileOptions.length + 2, 4), fileListHeight),
    options: fileOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: initialFileIndex,
    showDescription: !compactLayout,
  })
  container.add(fileSelect)

  const quantLabel = new TextRenderable(ctx, {
    id: "quant-label",
    content: "Select quantization type:",
    fg: "white",
    height: 1,
    marginTop: 1,
  })
  container.add(quantLabel)

  const quantOptions: SelectOption[] = QUANT_TYPES.map((qt) => ({
    name: `${qt.name.padEnd(10)} ${formatTier(qt.tier)}`,
    description: `${qt.description} | approx ${Math.round(qt.estimatedSizeRatio * 100)}% of source`,
    value: qt.name,
  }))
  const configuredQuantIndex = QUANT_TYPES.findIndex((qt) => qt.name === config.lastQuantType)

  const quantSelect = new SelectRenderable(ctx, {
    id: "quant-select",
    height: Math.min(Math.max(quantOptions.length + 2, 4), quantListHeight),
    options: quantOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: configuredQuantIndex >= 0 ? configuredQuantIndex : 2,
    showDescription: !compactLayout,
  })
  container.add(quantSelect)

  const outputLabel = new TextRenderable(ctx, {
    id: "output-label",
    content: "Output filename:",
    fg: "white",
    height: 1,
    marginTop: 1,
  })
  container.add(outputLabel)

  const outputInput = new InputRenderable(ctx, {
    id: "output-input",
    width: "100%",
    value: "",
    placeholder: "model-Q4_K_M.gguf",
    textColor: "white",
  })
  container.add(outputInput)

  const pruneLabel = new TextRenderable(ctx, {
    id: "prune-label",
    content: "Prune layers (optional):",
    fg: "white",
    height: 1,
    marginTop: 1,
  })
  container.add(pruneLabel)

  const pruneInput = new InputRenderable(ctx, {
    id: "prune-input",
    width: "100%",
    value: "",
    placeholder: "Comma-separated layers, e.g. 0,2,5",
    textColor: "white",
  })
  container.add(pruneInput)

  const errorText = new TextRenderable(ctx, {
    id: "prune-error",
    content: "No layers selected for pruning",
    fg: "gray",
    height: 1,
  })
  container.add(errorText)

  let cachedLayerCount: number | null = null
  let cachedLayerFile: string | null = null
  let outputEdited = false
  let updatingOutputName = false
  let previewReady = false

  const panel = createProcessPanel(ctx, "quantize-panel")
  container.add(panel.container)

  const hintText = new TextRenderable(ctx, {
    id: "quantize-hint",
    content: "Arrows: select  |  Tab: switch field  |  Enter: preview/start  |  Esc: back",
    fg: "gray",
  })
  container.add(hintText)

  const getSelectedFile = () => fileSelect.getSelectedOption()?.value as string | undefined
  const getSelectedQuantType = () => quantSelect.getSelectedOption()?.value as string | undefined
  const getSelectedQuantConfig = () => QUANT_TYPES.find((qt) => qt.name === getSelectedQuantType())

  const getDefaultOutputName = () => {
    const selectedFile = getSelectedFile()
    const quantType = getSelectedQuantType()
    if (!selectedFile || !quantType) return ""
    const baseName = path.basename(selectedFile, ".gguf")
    return `${baseName}-${quantType}.gguf`
  }

  const refreshOutputName = () => {
    if (!outputEdited) {
      updatingOutputName = true
      outputInput.value = getDefaultOutputName()
      updatingOutputName = false
    }
  }

  const getOutputFile = () => {
    const outputName = outputInput.value.trim()
    if (!outputName) return null
    return resolvePath(path.join(config.outputModelsDir, outputName))
  }

  const resetPreview = () => {
    previewReady = false
    panel.setStatus("Ready")
    hintText.content = "Arrows: select  |  Tab: switch field  |  Enter: preview/start  |  Esc: back"
  }

  const renderHistory = () => {
    panel.clear()
    panel.setStatus("Ready")
    const history = config.quantizationHistory.slice(0, 3)
    if (history.length === 0) {
      panel.addLine("Recent quantization runs will appear here.", "gray")
      return
    }
    panel.addLine("Recent quantization runs:", "cyan")
    for (const entry of history) {
      const status = entry.success ? "ok" : "failed"
      panel.addLine(`${status}: ${path.basename(entry.output)} (${entry.quantType})`, entry.success ? "green" : "yellow")
    }
  }

  const updateLayerCount = () => {
    const selectedFile = getSelectedFile()
    if (!selectedFile) {
      columnHint.content = "Layers: unknown"
      columnHint.fg = "yellow"
      cachedLayerCount = null
      cachedLayerFile = null
      return
    }
    const fullPath = resolvePath(path.join(config.sourceModelsDir, selectedFile))
    if (fullPath !== cachedLayerFile) {
      cachedLayerCount = getGgufLayerCount(fullPath)
      cachedLayerFile = fullPath
    }
    columnHint.content = cachedLayerCount !== null
      ? `Layers: ${cachedLayerCount} (0-${cachedLayerCount - 1})`
      : "Layers: unknown"
    columnHint.fg = cachedLayerCount !== null ? "cyan" : "yellow"
  }

  const updatePruneValidation = () => {
    const validation = parsePruneLayers(pruneInput.value.trim(), cachedLayerCount)
    errorText.content = validation.message
    errorText.fg = validation.valid ? (validation.layers.length > 0 ? "green" : "gray") : "red"
    return validation
  }

  const updateDerivedFields = () => {
    updateLayerCount()
    refreshOutputName()
    updatePruneValidation()
    resetPreview()
  }

  updateLayerCount()
  refreshOutputName()
  updatePruneValidation()
  renderHistory()

  let quantizing = false
  let focusedSelect: FocusedField = "file"

  const focusSelectedList = () => {
    fileSelect.blur()
    quantSelect.blur()
    outputInput.blur()
    pruneInput.blur()
    if (focusedSelect === "file") {
      fileSelect.focus()
    } else if (focusedSelect === "quant") {
      quantSelect.focus()
    } else if (focusedSelect === "output") {
      outputInput.focus()
    } else {
      pruneInput.focus()
    }
  }

  const showPreview = (): boolean => {
    const selectedFile = getSelectedFile()
    const quantType = getSelectedQuantType()
    const outputFile = getOutputFile()
    const validation = updatePruneValidation()

    if (!selectedFile || !quantType || !outputFile) {
      errorText.content = "Select a model, quant type, and output filename first"
      errorText.fg = "red"
      return false
    }
    if (/[\\/]/.test(outputInput.value.trim())) {
      errorText.content = "Output filename cannot include folders"
      errorText.fg = "red"
      return false
    }
    if (!validation.valid) return false

    const inputFile = resolvePath(path.join(config.sourceModelsDir, selectedFile))
    const quantConfig = getSelectedQuantConfig()
    const selectedModel = files.find((f) => f.path === selectedFile)
    const estimatedOutput = quantConfig && selectedModel
      ? formatFileSize(selectedModel.size * quantConfig.estimatedSizeRatio)
      : "unknown"
    const willOverwrite = fs.existsSync(outputFile)

    panel.clear()
    panel.setStatus(willOverwrite ? "Confirm overwrite" : "Confirm quantization")
    panel.addLine("Quantization preview", "cyan")
    panel.addLine(`Input: ${inputFile}`, "white")
    panel.addLine(`Output: ${outputFile}`, willOverwrite ? "yellow" : "white")
    panel.addLine(`Type: ${quantType} (${formatTier(quantConfig?.tier || "unknown")})`, "white")
    panel.addLine(`Threads: ${config.defaultThreads}`, "white")
    panel.addLine(`Layers: ${cachedLayerCount !== null ? `${cachedLayerCount} (0-${cachedLayerCount - 1})` : "unknown"}`, "white")
    panel.addLine(`Prune: ${validation.layers.length > 0 ? validation.layers.join(", ") : "none"}`, "white")
    panel.addLine(`Estimated output size: ${estimatedOutput}`, "white")
    if (willOverwrite) {
      panel.addLine("Warning: output file already exists. Press Enter again to overwrite.", "yellow")
    } else {
      panel.addLine("Press Enter again to start.", "green")
    }
    previewReady = true
    hintText.content = "Enter: confirm  |  Tab/arrows/type: edit preview  |  Esc: back"
    return true
  }

  const rememberRun = (selectedFile: string, quantType: string, outputFile: string, pruneLayers: string[], success: boolean, exitCode: number | null) => {
    config.lastQuantSource = selectedFile
    config.lastQuantType = quantType
    config.quantizationHistory = [
      {
        input: selectedFile,
        output: outputFile,
        quantType,
        prunedLayers: pruneLayers,
        timestamp: new Date().toISOString(),
        success,
        exitCode,
      },
      ...config.quantizationHistory,
    ].slice(0, 20)
    saveConfig(config)
  }

  const startQuantize = async () => {
    if (quantizing) return

    if (!previewReady) {
      showPreview()
      return
    }

    const selectedFile = getSelectedFile()
    const quantType = getSelectedQuantType()
    const outputFile = getOutputFile()
    const validation = updatePruneValidation()
    if (!selectedFile || !quantType || !outputFile || !validation.valid) {
      previewReady = false
      return
    }

    const llamaQuantize = config.llamaCppPath
      ? path.join(config.llamaCppPath, process.platform === "win32" ? "llama-quantize.exe" : "llama-quantize")
      : process.platform === "win32" ? "llama-quantize.exe" : "llama-quantize"

    const inputFile = resolvePath(path.join(config.sourceModelsDir, selectedFile))
    ensureDir(config.outputModelsDir)

    quantizing = true
    previewReady = false
    panel.clear()
    panel.setStatus("Quantizing...")
    panel.addLine(`Quantizing: ${selectedFile}`, "cyan")
    panel.addLine(`Output: ${outputFile}`, "cyan")
    panel.addLine(`Type: ${quantType}`, "cyan")
    if (validation.layers.length > 0) {
      panel.addLine(`Pruning layers: ${validation.layers.join(", ")}`, "yellow")
    }
    panel.addLine("", "white")

    const args: string[] = [inputFile, outputFile, quantType, String(config.defaultThreads)]
    if (validation.layers.length > 0) {
      args.push("--prune-layers", validation.layers.join(","))
    }

    const result = await runProcess({
      cmd: llamaQuantize,
      args,
      onOutput: (line, stream) => {
        panel.addLine(line, stream === "stderr" ? "yellow" : "white")
      },
    })

    quantizing = false
    const success = result.exitCode === 0
    rememberRun(selectedFile, quantType, outputFile, validation.layers, success, result.exitCode)

    if (success) {
      panel.setStatus("Complete!")
      panel.addLine("", "white")
      panel.addLine("Quantization complete!", "green")
      panel.addLine(`Output: ${outputFile}`, "green")
    } else {
      panel.setStatus("Failed")
      panel.addLine("", "white")
      panel.addLine(`Quantization failed (exit code ${result.exitCode})`, "red")
      if (result.stderr) {
        panel.addLine(result.stderr, "red")
      }
      for (const hint of getFailureHints(result, llamaQuantize)) {
        panel.addLine(`Hint: ${hint}`, "yellow")
      }
    }
  }

  const onKey = (key: any) => {
    if (key.name === "escape") {
      popScreen()
      return
    }

    if (key.name === "tab") {
      focusedSelect = focusedSelect === "file"
        ? "quant"
        : focusedSelect === "quant"
          ? "output"
          : focusedSelect === "output"
            ? "prune"
            : "file"
      focusSelectedList()
      return
    }

    if ((key.name === "up" || key.name === "down") && (focusedSelect === "file" || focusedSelect === "quant")) {
      process.nextTick(() => updateDerivedFields())
    }

    if (key.name === "return" || key.name === "enter") {
      startQuantize()
    }
  }
  renderer.keyInput.on("keypress", onKey)
  setCleanup(() => renderer.keyInput.off("keypress", onKey))

  process.nextTick(() => {
    focusSelectedList()
  })

  outputInput.on("input", () => {
    if (updatingOutputName) return
    outputEdited = true
    resetPreview()
  })
  pruneInput.on("input", () => {
    updatePruneValidation()
    resetPreview()
  })

  return container
}
