import type { CliRenderer } from "@opentui/core"
import { BoxRenderable, TextRenderable, type RenderContext } from "@opentui/core"
import { loadConfig } from "../../lib/config"
import { checkCommandExists } from "../../lib/process_runner"
import { fileExists } from "../../lib/file_utils"

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
    content: "",
    fg: "gray",
  })

  container.add(leftText)
  container.add(rightText)

  updateStatusBar(ctx, container)

  return container
}

export async function updateStatusBar(ctx: RenderContext, bar: BoxRenderable) {
  const config = loadConfig()
  const parts: string[] = []

  if (config.llamaCppPath && fileExists(config.llamaCppPath)) {
    parts.push(`llama.cpp: ${config.llamaCppVersion || "installed"}`)
  } else {
    parts.push("llama.cpp: not installed")
  }

  const hasPython = await checkCommandExists("python")
  parts.push(hasPython ? "Python: yes" : "Python: no")

  const hasHf = await checkCommandExists("hf")
  parts.push(hasHf ? "HF CLI: yes" : "HF CLI: no")

  const rightText = bar.getRenderable("status-right") as TextRenderable | undefined
  if (rightText) {
    rightText.content = parts.join(" | ")
    bar.requestRender()
  }
}
