import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  type SelectOption,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, resolvePath } from "../lib/config"
import { scanForGgufFiles, formatFileSize } from "../lib/file_utils"
import { createProcessPanel } from "./components/process_panel"
import {
  analyzeGgufFile,
  buildProfileFileName,
  saveExtractedProfile,
  type ExtractedProfileResult,
} from "../lib/gguf_profile_extractor"
import * as path from "path"

function formatTypeCounts(typeCounts: Record<string, number>): string {
  return Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${type}:${count}`)
    .join("  ")
}

function collectGgufFiles(config: ReturnType<typeof loadConfig>) {
  return [
    ...scanForGgufFiles(config.sourceModelsDir).map((file) => ({
      labelPath: path.join(config.sourceModelsDir, file.path),
      fullPath: resolvePath(path.join(config.sourceModelsDir, file.path)),
      name: file.name,
      size: file.size,
    })),
    ...scanForGgufFiles(config.outputModelsDir).map((file) => ({
      labelPath: path.join(config.outputModelsDir, file.path),
      fullPath: resolvePath(path.join(config.outputModelsDir, file.path)),
      name: file.name,
      size: file.size,
    })),
  ].filter((file, index, all) => all.findIndex((candidate) => candidate.fullPath === file.fullPath) === index)
}

export function createAnalyzeProfileScreen(renderer: CliRenderer): BoxRenderable {
  const ctx = renderer
  const config = loadConfig()
  const compactLayout = renderer.height < 30
  const files = collectGgufFiles(config)
  const fileListHeight = compactLayout ? 5 : 8

  let analyzing = false
  let latestResult: ExtractedProfileResult | null = null
  let latestFile: string | null = null
  let savedPath: string | null = null

  const container = new BoxRenderable(ctx, {
    id: "analyze-profile-screen",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    padding: 1,
  })

  const title = new TextRenderable(ctx, {
    id: "analyze-profile-title",
    content: "=== Analyze GGUF Quantization Profile ===",
    fg: "cyan",
    height: 1,
  })
  container.add(title)

  if (files.length === 0) {
    const noFiles = new TextRenderable(ctx, {
      id: "no-analyze-gguf",
      content: "No GGUF files found in source_models/ or output_models/",
      fg: "yellow",
    })
    container.add(noFiles)
    const hint = new TextRenderable(ctx, {
      id: "analyze-profile-hint",
      content: "Esc: back",
      fg: "gray",
    })
    container.add(hint)
    const onKey = (key: any) => {
      if (key.name === "escape") popScreen()
    }
    renderer.keyInput.on("keypress", onKey)
    setCleanup(() => renderer.keyInput.off("keypress", onKey))
    return container
  }

  const fileLabel = new TextRenderable(ctx, {
    id: "analyze-file-label",
    content: "Select reference GGUF file:",
    fg: "white",
    height: 1,
  })
  container.add(fileLabel)

  const fileOptions: SelectOption[] = files.map((file) => ({
    name: file.name,
    description: compactLayout ? formatFileSize(file.size) : `${file.labelPath} (${formatFileSize(file.size)})`,
    value: file.fullPath,
  }))

  const fileSelect = new SelectRenderable(ctx, {
    id: "analyze-file-select",
    height: Math.min(Math.max(fileOptions.length + 2, 4), fileListHeight),
    options: fileOptions,
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
  container.add(fileSelect)

  const panel = createProcessPanel(ctx, "analyze-profile-panel")
  container.add(panel.container)

  const hint = new TextRenderable(ctx, {
    id: "analyze-profile-hint",
    content: "Enter: analyze | S: save profile after preview | Esc: back",
    fg: "gray",
    height: 1,
  })
  container.add(hint)

  function renderPreview(result: ExtractedProfileResult, filePath: string) {
    panel.clear()
    panel.setStatus(savedPath ? "Saved" : "Preview ready")
    panel.addLine(`Reference: ${path.basename(filePath)}`, "cyan")
    panel.addLine(`Profile: ${result.profile.name}`, "white")
    panel.addLine(`Base type: ${result.profile.baseQuantType}`, "white")
    panel.addLine(`Tensors: ${result.tensorCount}`, "white")
    panel.addLine(`Type counts: ${formatTypeCounts(result.typeCounts) || "none"}`, "gray")
    panel.addLine(`Generated rules: ${result.generatedRuleCount}`, "white")
    if (result.profile.tokenEmbeddingType) panel.addLine(`Token embedding override: ${result.profile.tokenEmbeddingType}`, "white")
    if (result.profile.outputTensorType) panel.addLine(`Output tensor override: ${result.profile.outputTensorType}`, "white")
    for (const warning of result.warnings) {
      panel.addLine(warning, "yellow")
    }
    if (savedPath) {
      panel.addLine(`Saved: ${savedPath}`, "green")
    } else {
      panel.addLine(`Destination: ${path.join(config.quantProfilesDir, buildProfileFileName(result.profile))}`, "cyan")
      panel.addLine("S: save profile | Enter: analyze again | Esc: back", "gray")
    }
  }

  async function analyzeSelected() {
    const selected = fileSelect.getSelectedOption()?.value as string | undefined
    if (!selected || analyzing) return

    analyzing = true
    latestResult = null
    latestFile = selected
    savedPath = null
    panel.clear()
    panel.setStatus("Analyzing")
    panel.addLine(`Reading GGUF metadata from ${path.basename(selected)}...`, "cyan")

    try {
      const result = await analyzeGgufFile(selected, config)
      latestResult = result
      renderPreview(result, selected)
    } catch (err: any) {
      panel.clear()
      panel.setStatus("Analyze failed")
      panel.addLine(err?.message || String(err), "red")
      panel.addLine("Check Setup/Settings for llama.cpp source availability, then try again.", "yellow")
    } finally {
      analyzing = false
    }
  }

  function saveLatest() {
    if (!latestResult || !latestFile || savedPath) return
    savedPath = saveExtractedProfile(latestResult.profile, config.quantProfilesDir)
    renderPreview(latestResult, latestFile)
  }

  const onKey = (key: any) => {
    if (key.name === "escape") {
      popScreen()
      return
    }
    if (key.name === "s") {
      saveLatest()
      return
    }
    if (key.name === "return" || key.name === "enter") {
      analyzeSelected()
    }
  }

  fileSelect.on("itemSelected", () => {
    analyzeSelected()
  })

  renderer.keyInput.on("keypress", onKey)
  setCleanup(() => renderer.keyInput.off("keypress", onKey))

  process.nextTick(() => {
    fileSelect.focus()
  })

  return container
}
