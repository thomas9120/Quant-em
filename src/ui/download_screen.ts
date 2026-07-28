import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  type KeyEvent,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, resolvePath, ensureDir, getEffectiveHfToken } from "../lib/config"
import { runProcess } from "../lib/process_runner"
import { checkHfCommandExists, getHfCommand } from "../lib/hf_cli"
import { createProcessPanel } from "./components/process_panel"
import { sanitizeDirName, removeDirIfEmpty } from "../lib/file_utils"
import * as path from "path"
import * as fs from "fs"

export function createDownloadScreen(renderer: CliRenderer): BoxRenderable {
  const ctx = renderer
  const config = loadConfig()

  const container = new BoxRenderable(ctx, {
    id: "download-screen",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    padding: 1,
  })

  const title = new TextRenderable(ctx, {
    id: "download-title",
    content: "=== Download Model from HuggingFace ===",
    fg: "cyan",
  })
  container.add(title)

  const repoLabel = new TextRenderable(ctx, {
    id: "repo-label",
    content: "Repo ID (e.g. TheBloke/Llama-2-7B-GGUF):",
    fg: "white",
  })
  container.add(repoLabel)

  const repoInput = new InputRenderable(ctx, {
    id: "repo-input",
    value: "",
    placeholder: "org/model-name",
    textColor: "white",
  })
  container.add(repoInput)

  const includeLabel = new TextRenderable(ctx, {
    id: "include-label",
    content: "Include pattern (optional, e.g. *.gguf):",
    fg: "white",
    marginTop: 1,
  })
  container.add(includeLabel)

  const includeInput = new InputRenderable(ctx, {
    id: "include-input",
    value: "",
    placeholder: "*.gguf (leave empty for all files)",
    textColor: "white",
  })
  container.add(includeInput)

  const panel = createProcessPanel(ctx, "download-panel")
  container.add(panel.container)

  const hintText = new TextRenderable(ctx, {
    id: "download-hint",
    content: "Enter: start download  |  Esc: back",
    fg: "gray",
  })
  container.add(hintText)

  let downloading = false
  let abortProcess: (() => void) | null = null
  let processAborted = false
  let focusedInput: "repo" | "include" = "repo"

  const abortRunningProcess = () => {
    if (abortProcess) {
      processAborted = true
      abortProcess()
      abortProcess = null
    }
  }

  const focusCurrentInput = () => {
    repoInput.blur()
    includeInput.blur()
    if (focusedInput === "repo") {
      repoInput.focus()
    } else {
      includeInput.focus()
    }
  }

  const startDownload = async () => {
    if (downloading) return

    const repoId = repoInput.value.trim()
    if (!repoId) {
      panel.addLine("Error: Please enter a repo ID", "red")
      return
    }

    if (!repoId.includes("/") || repoId.split("/").length !== 2 || repoId.includes("..")) {
      panel.addLine("Error: Invalid repo ID. Expected format: org/model-name", "red")
      return
    }

    if (!(await checkHfCommandExists())) {
      panel.clear()
      panel.setStatus("Failed")
      panel.addLine("Error: Hugging Face CLI (hf) not found.", "red")
      panel.addLine("Install it from Setup → HuggingFace CLI", "yellow")
      panel.addLine('Or run: python -m pip install -U "huggingface_hub[cli]"', "yellow")
      return
    }

    downloading = true
    panel.clear()
    panel.setStatus("Downloading...")
    panel.addLine(`Downloading from: ${repoId}`, "cyan")

    const repoName = sanitizeDirName(repoId.split("/").pop() || repoId.replace("/", "-"))
    const localDir = resolvePath(path.join(config.sourceModelsDir, repoName))
    const localDirExistedBefore = fs.existsSync(localDir)
    if (!localDirExistedBefore) {
      ensureDir(path.join(config.sourceModelsDir, repoName))
    }

    const args = ["download", repoId, "--local-dir", localDir]
    const include = includeInput.value.trim()
    if (include) {
      args.push("--include", include)
    }
    const env: Record<string, string> = {
      HF_HUB_DISABLE_PROGRESS_BARS: "1",
    }
    const effectiveToken = getEffectiveHfToken(config)
    if (effectiveToken) {
      env.HF_TOKEN = effectiveToken
    }

    processAborted = false
    const { result, abort: abortDownload } = runProcess({
      cmd: getHfCommand(),
      args,
      env,
      onOutput: (line, stream) => {
        panel.addLine(line, stream === "stderr" ? "yellow" : "white")
      },
    })
    abortProcess = abortDownload

    const resultData = await result

    abortProcess = null
    downloading = false

    if (processAborted) {
      if (!localDirExistedBefore) {
        removeDirIfEmpty(path.join(config.sourceModelsDir, repoName))
      }
      return
    }

    if (resultData.exitCode === 0) {
      panel.setStatus("Complete!")
      panel.addLine("", "white")
      panel.addLine("Download complete!", "green")
      panel.addLine(`Files saved to: ${localDir}`, "green")
    } else {
      if (!localDirExistedBefore) {
        removeDirIfEmpty(path.join(config.sourceModelsDir, repoName))
      }
      panel.setStatus("Failed")
      panel.addLine("", "white")
      panel.addLine(`Download failed (exit code ${resultData.exitCode})`, "red")
      if (resultData.stderr) {
        panel.addLine(resultData.stderr, "red")
      }
    }
  }

  repoInput.on("enter", () => startDownload())
  includeInput.on("enter", () => startDownload())

  const onKey = (key: KeyEvent) => {
    if (key.name === "escape") {
      abortRunningProcess()
      popScreen()
      return
    }

    if (key.name === "tab") {
      focusedInput = focusedInput === "repo" ? "include" : "repo"
      focusCurrentInput()
    }
  }
  renderer.keyInput.on("keypress", onKey)
  setCleanup(() => {
    abortRunningProcess()
    renderer.keyInput.off("keypress", onKey)
  })

  process.nextTick(() => {
    focusCurrentInput()
  })

  return container
}
