import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  type SelectOption,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, resolvePath, ensureDir } from "../lib/config"
import { scanForSafetensorsDirs } from "../lib/file_utils"
import { runProcess, checkCommandExists } from "../lib/process_runner"
import { createProcessPanel } from "./components/process_panel"
import * as path from "path"
import * as fs from "fs"

function findConvertScript(llamaCppPath: string | null): string | null {
  const scriptName = "convert_hf_to_gguf.py"
  const candidates: string[] = []

  if (llamaCppPath) {
    let dir = resolvePath(llamaCppPath)
    for (let i = 0; i < 5; i++) {
      candidates.push(path.join(dir, scriptName))
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  candidates.push(resolvePath(path.join("llama_cpp", scriptName)))
  candidates.push(resolvePath(scriptName))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

export function createConvertScreen(renderer: CliRenderer): BoxRenderable {
  const ctx = renderer
  const config = loadConfig()

  const container = new BoxRenderable(ctx, {
    id: "convert-screen",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    padding: 1,
  })

  const title = new TextRenderable(ctx, {
    id: "convert-title",
    content: "=== Convert Safetensors to GGUF ===",
    fg: "cyan",
  })
  container.add(title)

  const dirs = scanForSafetensorsDirs(config.sourceModelsDir)

  if (dirs.length === 0) {
    const onKey = (key: any) => {
      if (key.name === "escape") popScreen()
    }
    renderer.keyInput.on("keypress", onKey)
    setCleanup(() => renderer.keyInput.off("keypress", onKey))

    const noModels = new TextRenderable(ctx, {
      id: "no-safetensors",
      content: "No safetensors directories found in source_models/",
      fg: "yellow",
    })
    container.add(noModels)

    const hintText = new TextRenderable(ctx, {
      id: "convert-hint",
      content: "Esc: back",
      fg: "gray",
    })
    container.add(hintText)

    return container
  }

  const label = new TextRenderable(ctx, {
    id: "convert-label",
    content: "Select model directory:",
    fg: "white",
  })
  container.add(label)

  const dirOptions: SelectOption[] = dirs.map((d) => ({
    name: d,
    description: "safetensors model",
    value: d,
  }))

  const dirSelect = new SelectRenderable(ctx, {
    id: "dir-select",
    options: dirOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: 0,
  })
  container.add(dirSelect)

  const precisionLabel = new TextRenderable(ctx, {
    id: "precision-label",
    content: "Output precision:",
    fg: "white",
    marginTop: 1,
  })
  container.add(precisionLabel)

  const precisionOptions: SelectOption[] = [
    { name: "F16", description: "Half precision (recommended)", value: "f16" },
    { name: "BF16", description: "BFloat16", value: "bf16" },
    { name: "F32", description: "Full precision", value: "f32" },
    { name: "Q8_0", description: "8-bit quantized", value: "q8_0" },
  ]

  const precisionSelect = new SelectRenderable(ctx, {
    id: "precision-select",
    options: precisionOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: 0,
  })
  container.add(precisionSelect)

  const panel = createProcessPanel(ctx, "convert-panel")
  container.add(panel.container)

  const hintText = new TextRenderable(ctx, {
    id: "convert-hint",
    content: "Enter: start conversion  |  Esc: back",
    fg: "gray",
  })
  container.add(hintText)

  let converting = false
  let focusedSelect: "dir" | "precision" = "dir"

  const focusSelectedList = () => {
    dirSelect.blur()
    precisionSelect.blur()
    if (focusedSelect === "dir") {
      dirSelect.focus()
    } else {
      precisionSelect.focus()
    }
  }

  const startConvert = async () => {
    if (converting) return

    const selectedDir = dirSelect.getSelectedOption()?.value as string
    if (!selectedDir) return

    const precision = precisionSelect.getSelectedOption()?.value as string

    const hasPython = await checkCommandExists("python")
    if (!hasPython) {
      panel.addLine("Error: Python not found. Install Python to use conversion.", "red")
      return
    }

    const scriptPath = findConvertScript(config.llamaCppPath)
    if (!scriptPath) {
      panel.setStatus("Failed")
      panel.addLine("Error: convert_hf_to_gguf.py was not found.", "red")
      panel.addLine("Set llama.cpp path to a full llama.cpp checkout, or place convert_hf_to_gguf.py in this repo's llama_cpp/ folder.", "yellow")
      panel.addLine("The llama.cpp binary releases include llama-quantize, but may not include the Python conversion script.", "yellow")
      return
    }

    converting = true
    panel.clear()
    panel.setStatus("Converting...")
    panel.addLine(`Converting ${selectedDir} to GGUF (${precision})...`, "cyan")

    const modelDir = resolvePath(path.join(config.sourceModelsDir, selectedDir))
    ensureDir(config.outputModelsDir)
    const outputFile = resolvePath(path.join(config.outputModelsDir, `${selectedDir}-${precision}.gguf`))

    const args = [scriptPath, modelDir, "--outfile", outputFile, "--outtype", precision]

    const result = await runProcess({
      cmd: "python",
      args,
      onOutput: (line, stream) => {
        panel.addLine(line, stream === "stderr" ? "yellow" : "white")
      },
    })

    converting = false

    if (result.exitCode === 0) {
      panel.setStatus("Complete!")
      panel.addLine("", "white")
      panel.addLine("Conversion complete!", "green")
      panel.addLine(`Output: ${outputFile}`, "green")
    } else {
      panel.setStatus("Failed")
      panel.addLine("", "white")
      panel.addLine(`Conversion failed (exit code ${result.exitCode})`, "red")
    }
  }

  const onKey = (key: any) => {
    if (key.name === "escape") {
      popScreen()
      return
    }

    if (key.name === "tab") {
      focusedSelect = focusedSelect === "dir" ? "precision" : "dir"
      focusSelectedList()
      return
    }

    if (key.name === "return" || key.name === "enter") {
      startConvert()
    }
  }
  renderer.keyInput.on("keypress", onKey)
  setCleanup(() => renderer.keyInput.off("keypress", onKey))

  process.nextTick(() => {
    focusSelectedList()
  })

  return container
}
