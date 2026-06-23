import { BoxRenderable, TextRenderable, type RenderContext } from "@opentui/core"
import { loadConfig } from "../../lib/config"
import { checkCommandExists } from "../../lib/process_runner"
import { checkHfCommandExists, getProjectHfCommand } from "../../lib/hf_cli"
import { fileExists } from "../../lib/file_utils"
import * as path from "path"

export function createStatusBar(ctx: RenderContext): BoxRenderable {
  const container = new BoxRenderable(ctx, {
    id: "status-bar",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingX: 1,
    height: 1,
  })

  const leftText = new TextRenderable(ctx, {
    id: "status-left",
    content: "Quant-em v0.1.0",
    fg: "cyan",
  })

  const rightText = new TextRenderable(ctx, {
    id: "status-right",
    content: "checking...",
    fg: "gray",
  })

  container.add(leftText)
  container.add(rightText)

  void updateStatusBar(ctx, container).catch((err: unknown) => {
    const right = container.getRenderable("status-right") as TextRenderable | undefined
    if (right) {
      right.content = "status unavailable"
      container.requestRender()
    }
    void err
  })

  return container
}

export async function updateStatusBar(_ctx: RenderContext, bar: BoxRenderable) {
  const config = loadConfig()
  const parts: string[] = []

  const quantizeBin = process.platform === "win32" ? "llama-quantize.exe" : "llama-quantize"
  const hasQuantize = config.llamaCppPath && fileExists(path.join(config.llamaCppPath, quantizeBin))

  if (hasQuantize) {
    parts.push(`llama.cpp: ${config.llamaCppVersion || "installed"}`)
  } else {
    parts.push("llama.cpp: not installed")
  }

  const hasPython = await checkCommandExists("python")
  parts.push(hasPython ? "Python: yes" : "Python: no")

  const hasProjectHf = Boolean(getProjectHfCommand())
  const hasHf = await checkHfCommandExists()
  parts.push(hasHf ? `HF CLI: ${hasProjectHf ? "venv" : "yes"}` : "HF CLI: no")

  const rightText = bar.getRenderable("status-right") as TextRenderable | undefined
  if (rightText) {
    rightText.content = parts.join(" | ")
    bar.requestRender()
  }
}
