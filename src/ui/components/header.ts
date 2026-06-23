import { BoxRenderable, TextRenderable, type RenderContext } from "@opentui/core"

const LOGO_LINES = [
  "   ___                  _                         ",
  "  / _ \\ _   _  __ _ _ __ | |_       ___ _ __ ___  ",
  " | | | | | | |/ _` | '_ \\| __|____ / _ \\ '_ ` _ \\ ",
  " | |_| | |_| | (_| | | | | ||_____|  __/ | | | | |",
  "  \\__\\_\\\\__,_|\\__,_|_| |_|\\__|     \\___|_| |_| |_|",
]

export function createHeader(ctx: RenderContext): BoxRenderable {
  const container = new BoxRenderable(ctx, {
    id: "header",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  })

  const topSpacer = new TextRenderable(ctx, {
    id: "logo-top-spacer",
    content: "",
    height: 1,
  })
  container.add(topSpacer)

  for (let i = 0; i < LOGO_LINES.length; i++) {
    const text = new TextRenderable(ctx, {
      id: `logo-line-${i}`,
      content: LOGO_LINES[i],
      fg: "cyan",
    })
    container.add(text)
  }

  const tagline = new TextRenderable(ctx, {
    id: "logo-tagline",
    content: "        Quantization Toolkit powered by llama.cpp",
    fg: "cyan",
  })
  container.add(tagline)

  return container
}
