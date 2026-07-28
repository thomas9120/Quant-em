import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  type SelectOption,
  type KeyEvent,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, resolvePath, ensureDir } from "../lib/config"
import { scanForSafetensorsDirs } from "../lib/file_utils"
import { runProcess, checkCommandExists } from "../lib/process_runner"
import { buildPythonPath, findConvertScript, getRequirementsPath } from "../lib/convert_tool"
import { getProjectVenvPython } from "../lib/project_venv"
import { createProcessPanel } from "./components/process_panel"
import * as path from "path"

export function createConvertScreen(renderer: CliRenderer): BoxRenderable {
  const ctx = renderer
  const config = loadConfig()
  const compactLayout = renderer.height < 28
  const dirListHeight = compactLayout ? 4 : 8

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
    const onKey = (key: KeyEvent) => {
      if (key.name === "escape") popScreen()
    }
    renderer.keyInput.on("keypress", onKey)
    setCleanup(() => {
      renderer.keyInput.off("keypress", onKey)
    })

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
    height: Math.min(Math.max(dirOptions.length + 2, 4), dirListHeight),
    options: dirOptions,
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
  container.add(dirSelect)

  const precisionLabel = new TextRenderable(ctx, {
    id: "precision-label",
    content: "Output precision:",
    fg: "white",
    marginTop: 1,
  })
  container.add(precisionLabel)

  const precisionOptions: SelectOption[] = [
    { name: "F16", description: "General-purpose intermediate for later quantization", value: "f16" },
    { name: "BF16", description: "Best intermediate when the source safetensors are BF16", value: "bf16" },
    { name: "F32", description: "Largest, highest-precision intermediate", value: "f32" },
    { name: "Q8_0", description: "Quantized output when you want to skip a separate quantize pass", value: "q8_0" },
  ]

  const precisionSelect = new SelectRenderable(ctx, {
    id: "precision-select",
    height: 6,
    options: precisionOptions,
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
  let abortProcess: (() => void) | null = null
  let processAborted = false
  let focusedSelect: "dir" | "precision" = "dir"

  const abortRunningProcess = () => {
    if (abortProcess) {
      processAborted = true
      abortProcess()
      abortProcess = null
    }
  }

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

    const pythonCmd = getProjectVenvPython() || "python"
    const hasPython = getProjectVenvPython() ? true : await checkCommandExists("python")
    if (!hasPython) {
      panel.addLine("Error: Python not found. Install Python to use conversion.", "red")
      return
    }

    const convertTool = findConvertScript(config.llamaCppSourcePath, config.llamaCppPath)
    if (!convertTool) {
      panel.setStatus("Failed")
      panel.addLine("Error: convert_hf_to_gguf.py was not found.", "red")
      panel.addLine("Run Setup again, or set llama.cpp source path in Settings to a full llama.cpp checkout.", "yellow")
      panel.addLine("The converter needs llama.cpp source files such as gguf-py, not just the binary release.", "yellow")
      return
    }
    if (!convertTool.ggufPyPath) {
      panel.setStatus("Failed")
      panel.addLine("Error: llama.cpp conversion modules were not found.", "red")
      panel.addLine("Set llama.cpp source path in Settings to a full llama.cpp checkout that contains gguf-py/.", "yellow")
      panel.addLine("Copying only convert_hf_to_gguf.py is not enough for GGUF conversion.", "yellow")
      return
    }

    converting = true
    panel.clear()
    panel.setStatus("Converting...")
    panel.addLine(`Converting ${selectedDir} to GGUF (${precision})...`, "cyan")
    panel.addLine(`Python: ${pythonCmd}`, "gray")

    const modelDir = resolvePath(path.join(config.sourceModelsDir, selectedDir))
    ensureDir(config.outputModelsDir)
    const outputFile = resolvePath(path.join(config.outputModelsDir, `${selectedDir}-${precision}.gguf`))

    const args = [convertTool.scriptPath, modelDir, "--outfile", outputFile, "--outtype", precision]

    processAborted = false
    const { result, abort: abortConvert } = runProcess({
      cmd: pythonCmd,
      args,
      cwd: convertTool.scriptDir,
      env: {
        PYTHONPATH: buildPythonPath(convertTool) || "",
      },
      onOutput: (line, stream) => {
        panel.addLine(line, stream === "stderr" ? "yellow" : "white")
      },
    })
    abortProcess = abortConvert

    const resultData = await result

    abortProcess = null
    converting = false

    if (processAborted) return

    if (resultData.exitCode === 0) {
      panel.setStatus("Complete!")
      panel.addLine("", "white")
      panel.addLine("Conversion complete!", "green")
      panel.addLine(`Output: ${outputFile}`, "green")
    } else {
      panel.setStatus("Failed")
      panel.addLine("", "white")
      panel.addLine(`Conversion failed (exit code ${resultData.exitCode})`, "red")
      if (resultData.stderr.includes("ModuleNotFoundError") || resultData.stdout.includes("ModuleNotFoundError")) {
        panel.addLine("Hint: install conversion deps from Setup → GGUF converter deps", "yellow")
        panel.addLine(`Or: "${pythonCmd}" -m pip install -r ${getRequirementsPath(convertTool.scriptDir)}`, "yellow")
      }
    }
  }

  const onKey = (key: KeyEvent) => {
    if (key.name === "escape") {
      abortRunningProcess()
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
  setCleanup(() => {
    abortRunningProcess()
    renderer.keyInput.off("keypress", onKey)
  })

  process.nextTick(() => {
    focusSelectedList()
  })

  return container
}
