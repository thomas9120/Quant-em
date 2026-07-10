import { BoxRenderable, TextRenderable, ScrollBoxRenderable, type RenderContext } from "@opentui/core"

export function createProcessPanel(ctx: RenderContext, id: string): {
  container: BoxRenderable
  scrollBox: ScrollBoxRenderable
  addLine: (text: string, color?: string) => void
  clear: () => void
  setStatus: (text: string) => void
} {
  const container = new BoxRenderable(ctx, {
    id,
    flexDirection: "column",
    flexGrow: 1,
    padding: 0,
    border: true,
    borderColor: "gray",
    title: "Output",
    titleAlignment: "left",
  })

  const statusText = new TextRenderable(ctx, {
    id: `${id}-status`,
    content: "Ready",
    fg: "green",
  })
  container.add(statusText)

  const scrollBox = new ScrollBoxRenderable(ctx, {
    id: `${id}-scroll`,
    flexGrow: 1,
    scrollY: true,
    stickyScroll: true,
    stickyStart: "bottom",
  })
  container.add(scrollBox)

  const MAX_LINES = 500
  let lineCounter = 0
  const lineIds: string[] = []

  const addLine = (text: string, color: string = "white") => {
    const lineId = `${id}-line-${lineCounter++}`
    const line = new TextRenderable(ctx, {
      id: lineId,
      content: text,
      fg: color,
    })
    scrollBox.add(line)
    lineIds.push(lineId)
    if (lineIds.length > MAX_LINES) {
      const oldest = lineIds.shift()!
      scrollBox.remove(oldest)
    }
    scrollBox.requestRender()
    container.requestRender()
  }

  const clear = () => {
    const children = [...scrollBox.getChildren()]
    for (const child of children) {
      scrollBox.remove(child.id)
    }
    lineCounter = 0
    lineIds.length = 0
    scrollBox.requestRender()
    container.requestRender()
  }

  const setStatus = (text: string) => {
    statusText.content = text
    statusText.requestRender()
    container.requestRender()
  }

  return { container, scrollBox, addLine, clear, setStatus }
}
