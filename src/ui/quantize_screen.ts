import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  InputRenderable,
  type SelectOption,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, saveConfig, resolvePath, ensureDir } from "../lib/config"
import { scanForGgufFiles, formatFileSize, getGgufLayerCount } from "../lib/file_utils"
import { runProcess } from "../lib/process_runner"
import { createProcessPanel } from "./components/process_panel"
import {
  buildQuantizeArgs,
  buildTensorTypeFileContent,
  formatLayerQuantSummary,
  formatMixedQuantLabel,
  parseLayerQuantRules,
} from "../lib/quantization_rules"
import {
  buildProfileTensorTypeFileContent,
  formatProfileSummary,
  scanForQuantizationProfiles,
} from "../lib/quantization_profiles"
import { QUANT_TYPES } from "../types"
import * as path from "path"
import * as fs from "fs"

type FocusedField = "file" | "mode" | "quant" | "embedding" | "profile" | "imatrix" | "rules" | "output" | "prune"

interface PruneValidation {
  layers: string[]
  valid: boolean
  message: string
}

function formatTier(tier: string): string {
  return tier.replace(/^\w/, (c) => c.toUpperCase())
}

function formatOptionalPath(filePath: string | null | undefined, compactLayout: boolean): string {
  if (!filePath) return "none"
  return compactLayout ? path.basename(filePath) : filePath
}

export function parsePruneLayers(value: string, layerCount: number | null): PruneValidation {
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

export function getFailureHints(result: { exitCode: number | null; stderr: string }, cmd: string): string[] {
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
  const fileListHeight = compactLayout ? 3 : 7
  const modeListHeight = compactLayout ? 3 : 4
  const quantListHeight = compactLayout ? 3 : 6

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
  const imatrixFiles = [
    ...scanForGgufFiles(config.sourceModelsDir).map((file) => ({
      labelPath: path.join(config.sourceModelsDir, file.path),
      fullPath: resolvePath(path.join(config.sourceModelsDir, file.path)),
      size: file.size,
    })),
    ...scanForGgufFiles(config.outputModelsDir).map((file) => ({
      labelPath: path.join(config.outputModelsDir, file.path),
      fullPath: resolvePath(path.join(config.outputModelsDir, file.path)),
      size: file.size,
    })),
  ].filter((file, index, all) => all.findIndex((candidate) => candidate.fullPath === file.fullPath) === index)
  const profiles = scanForQuantizationProfiles(config.quantProfilesDir)
  const hasProfiles = profiles.length > 0

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
    content: "Quantization mode:",
    fg: "white",
    height: 1,
    marginTop: 1,
  })
  container.add(quantLabel)

  const modeOptions: SelectOption[] = [
    { name: "Standard", description: "Use selected quant type and optional manual layer overrides", value: "standard" },
    { name: "JSON profile", description: "Use a quant_profiles/*.json tensor profile", value: "profile" },
  ]
  const modeSelect = new SelectRenderable(ctx, {
    id: "mode-select",
    height: modeListHeight,
    options: modeOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: profiles.length > 0 && config.lastQuantProfile ? 1 : 0,
    showDescription: !compactLayout,
  })
  container.add(modeSelect)

  const defaultQuantLabel = new TextRenderable(ctx, {
    id: "default-quant-label",
    content: "Default quantization type:",
    fg: "white",
    height: 1,
    marginTop: 1,
  })
  container.add(defaultQuantLabel)

  const quantOptions: SelectOption[] = QUANT_TYPES.map((qt) => ({
    name: `${qt.name.padEnd(10)} ${formatTier(qt.tier)}`,
    description: `${qt.description} | approx ${Math.round(qt.estimatedSizeRatio * 100)}% of source`,
    value: qt.name,
  }))
  const defaultQuantIndex = QUANT_TYPES.findIndex((qt) => qt.name === "Q6_K")
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
    selectedIndex: configuredQuantIndex >= 0 ? configuredQuantIndex : Math.max(0, defaultQuantIndex),
    showDescription: !compactLayout,
  })
  container.add(quantSelect)

  const embeddingLabel = new TextRenderable(ctx, {
    id: "embedding-label",
    content: "Token embedding handling (standard mode):",
    fg: "white",
    height: 1,
    marginTop: 1,
  })
  container.add(embeddingLabel)

  const embeddingOptions: SelectOption[] = [
    {
      name: "llama.cpp default",
      description: "Let llama.cpp choose token embedding precision for quality",
      value: "default",
    },
    {
      name: "Match selected quant",
      description: "Force token_embd.weight to the selected default quant type",
      value: "match-default",
    },
  ]
  const embeddingSelect = new SelectRenderable(ctx, {
    id: "embedding-select",
    height: compactLayout ? 3 : 4,
    options: embeddingOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: 0,
    showDescription: !compactLayout,
  })
  container.add(embeddingSelect)

  const profileOptions: SelectOption[] = [
    {
      name: "None",
      description: "Do not use a JSON profile; use the selected quant type",
      value: "",
    },
    ...profiles.map((profile) => ({
      name: profile.name,
      description: formatProfileSummary(profile.profile),
      value: profile.path,
    })),
  ]
  const configuredProfileIndex = config.lastQuantProfile
    ? Math.max(0, profileOptions.findIndex((profile) => profile.value === config.lastQuantProfile))
    : 0
  const profileSelect = new SelectRenderable(ctx, {
    id: "profile-select",
    height: Math.min(Math.max(profileOptions.length + 2, 3), compactLayout ? 3 : 4),
    options: profileOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: configuredProfileIndex,
    showDescription: !compactLayout,
  })
  if (hasProfiles) {
    const profileLabel = new TextRenderable(ctx, {
      id: "profile-label",
      content: "JSON quantization profile:",
      fg: "white",
      height: 1,
      marginTop: 1,
    })
    container.add(profileLabel)
    container.add(profileSelect)
  }

  const imatrixLabel = new TextRenderable(ctx, {
    id: "imatrix-label",
    content: "Importance matrix (optional):",
    fg: "white",
    height: 1,
    marginTop: 1,
  })
  container.add(imatrixLabel)

  const imatrixOptions: SelectOption[] = [
    {
      name: "None",
      description: "Do not pass an imatrix file to llama-quantize",
      value: "",
    },
    ...imatrixFiles.map((file) => ({
      name: path.basename(file.labelPath),
      description: compactLayout ? formatFileSize(file.size) : `${file.labelPath} (${formatFileSize(file.size)})`,
      value: file.fullPath,
    })),
  ]
  const configuredImatrixIndex = config.lastImatrixFile
    ? Math.max(0, imatrixOptions.findIndex((option) => option.value === config.lastImatrixFile))
    : 0
  const imatrixSelect = new SelectRenderable(ctx, {
    id: "imatrix-select",
    height: Math.min(Math.max(imatrixOptions.length + 2, 3), compactLayout ? 3 : 4),
    options: imatrixOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: configuredImatrixIndex,
    showDescription: !compactLayout,
  })
  container.add(imatrixSelect)

  const rulesLabel = new TextRenderable(ctx, {
    id: "layer-quant-label",
    content: "Advanced layer quantization (optional):",
    fg: "white",
    height: 1,
    marginTop: 1,
  })
  container.add(rulesLabel)

  const rulesInput = new InputRenderable(ctx, {
    id: "layer-quant-input",
    width: "100%",
    value: "",
    placeholder: "0-3=Q8_0; 4-20=Q5_K_M; 21-31=Q4_K_M",
    textColor: "white",
  })
  container.add(rulesInput)

  const rulesError = new TextRenderable(ctx, {
    id: "layer-quant-error",
    content: "No layer quantization overrides",
    fg: "gray",
    height: 1,
  })
  container.add(rulesError)

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
  const getSelectedMode = () => modeSelect.getSelectedOption()?.value as "standard" | "profile" | undefined
  const getSelectedQuantType = () => quantSelect.getSelectedOption()?.value as string | undefined
  const getSelectedEmbeddingMode = () => embeddingSelect.getSelectedOption()?.value as "default" | "match-default" | undefined
  const getSelectedQuantConfig = () => QUANT_TYPES.find((qt) => qt.name === getSelectedQuantType())
  const getSelectedProfilePath = () => {
    const value = profileSelect.getSelectedOption()?.value as string | undefined
    return value || undefined
  }
  const getSelectedImatrixFile = () => {
    const value = imatrixSelect.getSelectedOption()?.value as string | undefined
    return value || null
  }
  const getSelectedProfile = () => profiles.find((profile) => profile.path === getSelectedProfilePath())?.profile || null
  const isUsingProfile = () => getSelectedMode() === "profile" && Boolean(getSelectedProfilePath())
  const getEffectiveQuantType = () => isUsingProfile()
    ? getSelectedProfile()?.baseQuantType
    : getSelectedQuantType()

  const getDefaultOutputName = () => {
    const selectedFile = getSelectedFile()
    const quantType = getEffectiveQuantType()
    if (!selectedFile || !quantType) return ""
    const baseName = path.basename(selectedFile, ".gguf")
    if (isUsingProfile()) {
      const profile = getSelectedProfile()
      const tag = profile?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile"
      return `${baseName}-${tag}-${quantType}.gguf`
    }
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
      const imatrix = entry.imatrixFile ? `; imatrix ${path.basename(entry.imatrixFile)}` : ""
      panel.addLine(`${status}: ${path.basename(entry.output)} (${entry.quantType}${imatrix})`, entry.success ? "green" : "yellow")
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

  const updateLayerQuantValidation = () => {
    const validation = parseLayerQuantRules(rulesInput.value.trim(), cachedLayerCount)
    rulesError.content = validation.message
    rulesError.fg = validation.valid ? (validation.rules.length > 0 ? "green" : "gray") : "red"
    return validation
  }

  const buildStandardTensorTypeFileContent = (quantType: string, rules: ReturnType<typeof parseLayerQuantRules>["rules"]) => {
    const sections: string[] = []
    if (getSelectedEmbeddingMode() === "match-default") {
      sections.push(`^token_embd\\.weight$=${quantType}`)
    }
    const layerContent = buildTensorTypeFileContent(rules)
    if (layerContent) sections.push(layerContent)
    return sections.join("\n")
  }

  const updateDerivedFields = () => {
    updateLayerCount()
    refreshOutputName()
    updatePruneValidation()
    updateLayerQuantValidation()
    resetPreview()
  }

  updateLayerCount()
  refreshOutputName()
  updatePruneValidation()
  updateLayerQuantValidation()
  renderHistory()

  let quantizing = false
  let focusedSelect: FocusedField = "file"

  const focusSelectedList = () => {
    fileSelect.blur()
    modeSelect.blur()
    quantSelect.blur()
    embeddingSelect.blur()
    profileSelect.blur()
    imatrixSelect.blur()
    rulesInput.blur()
    outputInput.blur()
    pruneInput.blur()
    if (focusedSelect === "file") {
      fileSelect.focus()
    } else if (focusedSelect === "quant") {
      quantSelect.focus()
    } else if (focusedSelect === "embedding") {
      embeddingSelect.focus()
    } else if (focusedSelect === "mode") {
      modeSelect.focus()
    } else if (focusedSelect === "profile" && hasProfiles) {
      profileSelect.focus()
    } else if (focusedSelect === "imatrix") {
      imatrixSelect.focus()
    } else if (focusedSelect === "rules") {
      rulesInput.focus()
    } else if (focusedSelect === "output") {
      outputInput.focus()
    } else {
      pruneInput.focus()
    }
  }

  const showPreview = (): boolean => {
    const selectedFile = getSelectedFile()
    const mode = getSelectedMode()
    const profile = getSelectedProfile()
    const quantType = getEffectiveQuantType()
    const imatrixFile = getSelectedImatrixFile()
    const outputFile = getOutputFile()
    const validation = updatePruneValidation()
    const layerQuantValidation = updateLayerQuantValidation()

    if (!selectedFile || !quantType || !outputFile) {
      errorText.content = "Select a model, default quant type, and output filename first"
      errorText.fg = "red"
      return false
    }
    if (/[\\/]/.test(outputInput.value.trim())) {
      errorText.content = "Output filename cannot include folders"
      errorText.fg = "red"
      return false
    }
    if (!validation.valid) return false
    if (!layerQuantValidation.valid) return false
    if (!isUsingProfile() && getSelectedEmbeddingMode() === "match-default" && quantType === "COPY") {
      errorText.content = "Token embedding override cannot use COPY"
      errorText.fg = "red"
      return false
    }

    const inputFile = resolvePath(path.join(config.sourceModelsDir, selectedFile))
    const quantConfig = isUsingProfile()
      ? QUANT_TYPES.find((qt) => qt.name === profile?.baseQuantType)
      : getSelectedQuantConfig()
    const selectedModel = files.find((f) => f.path === selectedFile)
    const estimatedOutput = quantConfig && selectedModel
      ? formatFileSize(selectedModel.size * quantConfig.estimatedSizeRatio)
      : "unknown"
    const willOverwrite = fs.existsSync(outputFile)
    const layerSummary = layerQuantValidation.rules.length > 0 ? formatLayerQuantSummary(layerQuantValidation.rules) : "none"

    panel.clear()
    panel.setStatus(willOverwrite ? "Confirm overwrite" : "Confirm quantization")
    panel.addLine("Quantization preview", "cyan")
    if (compactLayout) {
      panel.addLine(`Estimated output size: ${estimatedOutput}${layerQuantValidation.rules.length > 0 ? " (rough)" : ""}`, "white")
      panel.addLine(willOverwrite ? "Press Enter again to overwrite." : "Press Enter again to start.", willOverwrite ? "yellow" : "green")
    }
    panel.addLine(`Input: ${compactLayout ? path.basename(inputFile) : inputFile}`, "white")
    panel.addLine(`Output: ${compactLayout ? path.basename(outputFile) : outputFile}`, willOverwrite ? "yellow" : "white")
    panel.addLine(`Imatrix: ${formatOptionalPath(imatrixFile, compactLayout)}`, imatrixFile ? "white" : "gray")
    if (isUsingProfile() && profile) {
      panel.addLine(`Profile: ${profile.name}`, "white")
      panel.addLine(`Base type: ${profile.baseQuantType} (${formatTier(quantConfig?.tier || "unknown")})`, "white")
      panel.addLine(`Tensor rules: ${profile.rules.length}`, "white")
    } else {
      panel.addLine(`Default type: ${quantType} (${formatTier(quantConfig?.tier || "unknown")})`, "white")
      panel.addLine(`Token embeddings: ${getSelectedEmbeddingMode() === "match-default" ? `force ${quantType}` : "llama.cpp default"}`, "white")
    }
    if (!compactLayout) {
      panel.addLine(`Layer overrides: ${layerSummary}`, "white")
    }
    panel.addLine(`Threads: ${config.defaultThreads}`, "white")
    if (!compactLayout) {
      panel.addLine(`Layers: ${cachedLayerCount !== null ? `${cachedLayerCount} (0-${cachedLayerCount - 1})` : "unknown"}`, "white")
    }
    panel.addLine(`Prune: ${validation.layers.length > 0 ? validation.layers.join(", ") : "none"}`, "white")
    if (compactLayout) {
      panel.addLine(`Layer overrides: ${layerSummary}`, "white")
    }
    if (!compactLayout) {
      panel.addLine(`Estimated output size: ${estimatedOutput}${layerQuantValidation.rules.length > 0 ? " (rough)" : ""}`, "white")
    }
    if (!isUsingProfile() && layerQuantValidation.rules.length > 0) {
      panel.addLine("Advanced mixed quantization should be tested for quality and speed.", "yellow")
    }
    if (!compactLayout) {
      if (willOverwrite) {
        panel.addLine("Warning: output file already exists. Press Enter again to overwrite.", "yellow")
      } else {
        panel.addLine("Press Enter again to start.", "green")
      }
    }
    previewReady = true
    hintText.content = "Enter: confirm  |  Tab/arrows/type: edit preview  |  Esc: back"
    return true
  }

  const rememberRun = (selectedFile: string, quantType: string, historyQuantType: string, outputFile: string, pruneLayers: string[], success: boolean, exitCode: number | null, profilePath: string | null, imatrixFile: string | null) => {
    config.lastQuantSource = selectedFile
    config.lastQuantType = quantType
    config.lastQuantProfile = profilePath
    config.lastImatrixFile = imatrixFile
    config.quantizationHistory = [
      {
        input: selectedFile,
        output: outputFile,
        quantType: historyQuantType,
        imatrixFile,
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
    const mode = getSelectedMode()
    const profile = getSelectedProfile()
    const profilePath = isUsingProfile() ? getSelectedProfilePath() || null : null
    const quantType = getEffectiveQuantType()
    const imatrixFile = getSelectedImatrixFile()
    const outputFile = getOutputFile()
    const validation = updatePruneValidation()
    const layerQuantValidation = updateLayerQuantValidation()
    if (!selectedFile || !quantType || !outputFile || !validation.valid || !layerQuantValidation.valid || (isUsingProfile() && !profile)) {
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
    if (imatrixFile) {
      panel.addLine(`Imatrix: ${imatrixFile}`, "cyan")
    }
    if (isUsingProfile() && profile) {
      panel.addLine(`Profile: ${profile.name}`, "cyan")
      panel.addLine(`Base type: ${profile.baseQuantType}`, "cyan")
      panel.addLine(`Tensor rules: ${profile.rules.length}`, "cyan")
    } else {
      panel.addLine(`Default type: ${quantType}`, "cyan")
    }
    if (!isUsingProfile() && layerQuantValidation.rules.length > 0) {
      panel.addLine(`Layer overrides: ${formatLayerQuantSummary(layerQuantValidation.rules)}`, "cyan")
    }
    if (validation.layers.length > 0) {
      panel.addLine(`Pruning layers: ${validation.layers.join(", ")}`, "yellow")
    }
    panel.addLine("", "white")

    let tensorTypeFile: string | null = null
    if (isUsingProfile() && profile) {
      const outputBase = path.basename(outputFile, path.extname(outputFile))
      tensorTypeFile = path.join(config.outputModelsDir, `${outputBase}.profile-tensor-types.txt`)
      fs.writeFileSync(resolvePath(tensorTypeFile), buildProfileTensorTypeFileContent(profile), "utf-8")
    } else if (layerQuantValidation.rules.length > 0 || getSelectedEmbeddingMode() === "match-default") {
      const outputBase = path.basename(outputFile, path.extname(outputFile))
      tensorTypeFile = path.join(config.outputModelsDir, `${outputBase}.tensor-types.txt`)
      fs.writeFileSync(resolvePath(tensorTypeFile), buildStandardTensorTypeFileContent(quantType, layerQuantValidation.rules), "utf-8")
    }
    const args = buildQuantizeArgs(inputFile, outputFile, quantType, config.defaultThreads, validation.layers, tensorTypeFile ? resolvePath(tensorTypeFile) : null, {
      allowRequantize: profile?.allowRequantize,
      tokenEmbeddingType: profile?.tokenEmbeddingType,
      outputTensorType: profile?.outputTensorType,
      imatrixFile,
    })

    const result = await runProcess({
      cmd: llamaQuantize,
      args,
      onOutput: (line, stream) => {
        panel.addLine(line, stream === "stderr" ? "yellow" : "white")
      },
    })
    if (tensorTypeFile) {
      try {
        fs.rmSync(resolvePath(tensorTypeFile), { force: true })
      } catch {
      }
    }

    quantizing = false
    const success = result.exitCode === 0
    const historyQuantType = isUsingProfile() && profile
      ? `profile: ${profile.name}; base ${profile.baseQuantType}`
      : formatMixedQuantLabel(quantType, layerQuantValidation.rules)
    rememberRun(selectedFile, quantType, historyQuantType, outputFile, validation.layers, success, result.exitCode, profilePath, imatrixFile)

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
        ? "mode"
        : focusedSelect === "mode"
        ? "quant"
        : focusedSelect === "quant"
          ? "embedding"
        : focusedSelect === "embedding"
          ? (hasProfiles ? "profile" : "imatrix")
          : focusedSelect === "profile"
          ? "imatrix"
          : focusedSelect === "imatrix"
          ? "rules"
          : focusedSelect === "rules"
          ? "output"
          : focusedSelect === "output"
            ? "prune"
            : "file"
      focusSelectedList()
      return
    }

    if ((key.name === "up" || key.name === "down") && (focusedSelect === "file" || focusedSelect === "mode" || focusedSelect === "quant" || focusedSelect === "embedding" || focusedSelect === "profile" || focusedSelect === "imatrix")) {
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
  fileSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => updateDerivedFields())
  modeSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => updateDerivedFields())
  quantSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => updateDerivedFields())
  embeddingSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => resetPreview())
  profileSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => updateDerivedFields())
  imatrixSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => resetPreview())
  rulesInput.on("input", () => {
    updateLayerQuantValidation()
    resetPreview()
  })
  pruneInput.on("input", () => {
    updatePruneValidation()
    resetPreview()
  })

  return container
}
