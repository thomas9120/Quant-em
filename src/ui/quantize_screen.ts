import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  type SelectOption,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, resolvePath, ensureDir } from "../lib/config"
import { scanForGgufFiles, formatFileSize } from "../lib/file_utils"
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

  const title = new TextRenderable(ctx, {
    id: "quantize-title",
    content: "=== Quantize GGUF Model ===",
    fg: "cyan",
  })
  container.add(title)

  const onKey = (key: any) => {
    if (key.name === "escape") popScreen()
  }
  renderer.keyInput.on("keypress", onKey)
  setCleanup(() => renderer.keyInput.off("keypress", onKey))

  const files = scanForGgufFiles(config.sourceModelsDir)

  if (files.length === 0) {
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
    name: `${f.path}  (${formatFileSize(f.size)})`,
    description: "",
    value: f.path,
  }))

  const fileSelect = new SelectRenderable(ctx, {
    id: "file-select",
    options: fileOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: 0,
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

  const panel = createProcessPanel(ctx, "quantize-panel")
  container.add(panel.container)

  const hintText = new TextRenderable(ctx, {
    id: "quantize-hint",
    content: "Enter: start quantization  |  Esc: back",
    fg: "gray",
  })
  container.add(hintText)

  let quantizing = false

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

    quantizing = true
    panel.clear()
    panel.setStatus("Quantizing...")
    panel.addLine(`Quantizing: ${selectedFile}`, "cyan")
    panel.addLine(`Output: ${baseName}-${quantType}.gguf`, "cyan")
    panel.addLine(`Type: ${quantType}`, "cyan")
    panel.addLine("", "white")

    const result = await runProcess({
      cmd: llamaQuantize,
      args: ["--threads", String(config.defaultThreads), inputFile, outputFile, quantType],
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

  fileSelect.on("itemSelected", () => startQuantize())
  quantSelect.on("itemSelected", () => startQuantize())

  return container
}
