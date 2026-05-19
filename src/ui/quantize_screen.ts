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
    content: "Tab switches lists",
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

  const panel = createProcessPanel(ctx, "quantize-panel")
  container.add(panel.container)

  const hintText = new TextRenderable(ctx, {
    id: "quantize-hint",
    content: "Arrows: select  |  Tab: switch list  |  Enter: start quantization  |  Esc: back",
    fg: "gray",
  })
  container.add(hintText)

  let quantizing = false
  let focusedSelect: "file" | "quant" = "file"

  const focusSelectedList = () => {
    if (focusedSelect === "file") {
      fileSelect.focus()
    } else {
      quantSelect.focus()
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

    quantizing = true
    panel.clear()
    panel.setStatus("Quantizing...")
    panel.addLine(`Quantizing: ${selectedFile}`, "cyan")
    panel.addLine(`Output: ${baseName}-${quantType}.gguf`, "cyan")
    panel.addLine(`Type: ${quantType}`, "cyan")
    panel.addLine("", "white")

    const result = await runProcess({
      cmd: llamaQuantize,
      args: [inputFile, outputFile, quantType, String(config.defaultThreads)],
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
      focusedSelect = focusedSelect === "file" ? "quant" : "file"
      focusSelectedList()
      return
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

  return container
}
