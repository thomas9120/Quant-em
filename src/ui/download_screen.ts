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
import { runProcess } from "../lib/process_runner"
import { createProcessPanel } from "./components/process_panel"
import * as path from "path"

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

  const startDownload = async () => {
    if (downloading) return

    const repoId = repoInput.value.trim()
    if (!repoId) {
      panel.addLine("Error: Please enter a repo ID", "red")
      return
    }

    downloading = true
    panel.clear()
    panel.setStatus("Downloading...")
    panel.addLine(`Downloading from: ${repoId}`, "cyan")

    const repoName = repoId.split("/").pop() || repoId.replace("/", "-")
    const localDir = resolvePath(path.join(config.sourceModelsDir, repoName))
    ensureDir(path.join(config.sourceModelsDir, repoName))

    const args = ["download", repoId, "--local-dir", localDir]
    const include = includeInput.value.trim()
    if (include) {
      args.push("--include", include)
    }
    if (config.hfToken) {
      args.push("--token", config.hfToken)
    }

    const result = await runProcess({
      cmd: "hf",
      args,
      onOutput: (line, stream) => {
        panel.addLine(line, stream === "stderr" ? "yellow" : "white")
      },
    })

    downloading = false

    if (result.exitCode === 0) {
      panel.setStatus("Complete!")
      panel.addLine("", "white")
      panel.addLine("Download complete!", "green")
      panel.addLine(`Files saved to: ${localDir}`, "green")
    } else {
      panel.setStatus("Failed")
      panel.addLine("", "white")
      panel.addLine(`Download failed (exit code ${result.exitCode})`, "red")
      if (result.stderr) {
        panel.addLine(result.stderr, "red")
      }
    }
  }

  repoInput.on("enter", () => startDownload())
  includeInput.on("enter", () => startDownload())

  const onKey = (key: any) => {
    if (key.name === "escape") popScreen()
  }
  renderer.keyInput.on("keypress", onKey)
  setCleanup(() => renderer.keyInput.off("keypress", onKey))

  return container
}
