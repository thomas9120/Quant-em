import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  InputRenderable,
  type SelectOption,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, resolvePath, ensureDir } from "../lib/config"
import { scanForGgufFiles, formatFileSize, getGgufLayerCount } from "../lib/file_utils"
import { runProcess } from "../lib/process_runner"
import { createProcessPanel } from "./components/process_panel"
import { QUANT_TYPES } from "../types"
import * as path from "path"

export function createQuantizeScreen(renderer: CliRenderer): BoxRenderable {
  const ctx = renderer
  const config = loadConfig()

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
    content: "Tab switches fields",
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
  })
  container.add(fileLabel)

  const fileOptions: SelectOption[] = files.map((f) => ({
    name: f.name,
    description: `${f.path} (${formatFileSize(f.size)})`,
    value: f.path,
  }))

  const fileSelect = new SelectRenderable(ctx, {
    id: "file-select",
    height: Math.min(Math.max(fileOptions.length + 2, 4), 10),
    options: fileOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: 0,
    showDescription: true,
  })
  container.add(fileSelect)

  const quantLabel = new TextRenderable(ctx, {
    id: "quant-label",
    content: "Select quantization type:",
    fg: "white",
    marginTop: 1,
  })
  container.add(quantLabel)

  const quantOptions: SelectOption[] = QUANT_TYPES.map((qt) => ({
    name: `${qt.name.padEnd(10)} [${qt.tier}]`,
    description: qt.description,
    value: qt.name,
  }))

  const quantSelect = new SelectRenderable(ctx, {
    id: "quant-select",
    height: 10,
    options: quantOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: 2,
    showDescription: true,
  })
  container.add(quantSelect)

  const layerInfoText = new TextRenderable(ctx, {
    id: "layer-info",
    content: "Determining layer count...",
    fg: "gray",
  })
  container.add(layerInfoText)

  const pruneLabel = new TextRenderable(ctx, {
    id: "prune-label",
    content: "Layers to prune (comma-separated, e.g. 0,2,5):",
    fg: "white",
    marginTop: 1,
  })
  container.add(pruneLabel)

  const pruneInput = new InputRenderable(ctx, {
    id: "prune-input",
    value: "",
    placeholder: "Leave empty for no pruning",
    textColor: "white",
  })
  container.add(pruneInput)

  const errorText = new TextRenderable(ctx, {
    id: "prune-error",
    content: "",
    fg: "red",
  })
  container.add(errorText)

  let cachedLayerCount: number | null = null
  let cachedLayerFile: string | null = null

  const updateLayerCount = () => {
    const selectedFile = fileSelect.getSelectedOption()?.value as string
    if (!selectedFile) {
      layerInfoText.content = "Model layer count: unknown"
      cachedLayerCount = null
      cachedLayerFile = null
      return
    }
    const fullPath = resolvePath(path.join(config.sourceModelsDir, selectedFile))
    if (fullPath !== cachedLayerFile) {
      cachedLayerCount = getGgufLayerCount(fullPath)
      cachedLayerFile = fullPath
    }
    layerInfoText.content = cachedLayerCount !== null
      ? `Model has ${cachedLayerCount} layers (0-${cachedLayerCount - 1})`
      : "Model layer count: unknown"
    errorText.content = ""
  }

  updateLayerCount()

  const panel = createProcessPanel(ctx, "quantize-panel")
  container.add(panel.container)

  const hintText = new TextRenderable(ctx, {
    id: "quantize-hint",
    content: "Arrows: select  |  Tab: switch field  |  Enter: start quantization  |  Esc: back",
    fg: "gray",
  })
  container.add(hintText)

  let quantizing = false
  let focusedSelect: "file" | "quant" | "prune" = "file"

  const focusSelectedList = () => {
    fileSelect.blur()
    quantSelect.blur()
    pruneInput.blur()
    if (focusedSelect === "file") {
      fileSelect.focus()
    } else if (focusedSelect === "quant") {
      quantSelect.focus()
    } else {
      pruneInput.focus()
    }
  }

  const startQuantize = async () => {
    if (quantizing) return

    const selectedFile = fileSelect.getSelectedOption()?.value as string
    const quantType = quantSelect.getSelectedOption()?.value as string
    if (!selectedFile || !quantType) return

    const llamaQuantize = config.llamaCppPath
      ? path.join(config.llamaCppPath, process.platform === "win32" ? "llama-quantize.exe" : "llama-quantize")
      : process.platform === "win32" ? "llama-quantize.exe" : "llama-quantize"

    const inputFile = resolvePath(path.join(config.sourceModelsDir, selectedFile))
    const baseName = path.basename(selectedFile, ".gguf")
    const outputFile = resolvePath(path.join(config.outputModelsDir, `${baseName}-${quantType}.gguf`))
    ensureDir(config.outputModelsDir)

    const pruneValue = pruneInput.value.trim()
    const pruneLayers = pruneValue.split(",").map(s => s.trim()).filter(s => s !== "")
    if (pruneLayers.length > 0) {
      const layerNums = pruneLayers.map(s => parseInt(s)).filter(n => !isNaN(n))
      if (layerNums.length !== pruneLayers.length) {
        errorText.content = "Invalid layer number detected (must be integers)"
        return
      }
      const layerCount = cachedLayerFile === inputFile ? cachedLayerCount : getGgufLayerCount(inputFile)
      if (layerCount !== null) {
        const invalid = layerNums.filter(n => n < 0 || n >= layerCount)
        if (invalid.length > 0) {
          errorText.content = `Invalid layer(s): ${invalid.join(", ")}. Valid range: 0-${layerCount - 1}`
          return
        }
      }
      const unique = new Set(layerNums)
      if (unique.size !== layerNums.length) {
        errorText.content = "Duplicate layer numbers detected"
        return
      }
    }
    errorText.content = ""

    quantizing = true
    panel.clear()
    panel.setStatus("Quantizing...")
    panel.addLine(`Quantizing: ${selectedFile}`, "cyan")
    panel.addLine(`Output: ${baseName}-${quantType}.gguf`, "cyan")
    panel.addLine(`Type: ${quantType}`, "cyan")
    if (pruneLayers.length > 0) {
      panel.addLine(`Pruning layers: ${pruneLayers.join(", ")}`, "yellow")
    }
    panel.addLine("", "white")

    const args: string[] = [inputFile, outputFile, quantType, String(config.defaultThreads)]
    if (pruneLayers.length > 0) {
      args.push("--prune-layers", pruneLayers.join(","))
    }

    const result = await runProcess({
      cmd: llamaQuantize,
      args,
      onOutput: (line, stream) => {
        panel.addLine(line, stream === "stderr" ? "yellow" : "white")
      },
    })

    quantizing = false

    if (result.exitCode === 0) {
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
    }
  }

  const onKey = (key: any) => {
    if (key.name === "escape") {
      popScreen()
      return
    }

    if (key.name === "tab") {
      focusedSelect = focusedSelect === "file" ? "quant" : focusedSelect === "quant" ? "prune" : "file"
      focusSelectedList()
      return
    }

    if ((key.name === "up" || key.name === "down") && focusedSelect === "file") {
      process.nextTick(() => updateLayerCount())
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

  pruneInput.on("enter", () => startQuantize())

  return container
}
