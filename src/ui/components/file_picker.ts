import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  type SelectOption,
  type RenderContext,
} from "@opentui/core"
import { scanForGgufFiles, formatFileSize } from "../../lib/file_utils"
import { loadConfig } from "../../lib/config"

export interface FilePickerOptions {
  id: string
  title: string
  extensions?: string[]
  onSelect: (filePath: string) => void
  onBack: () => void
}

export function createFilePicker(
  ctx: RenderContext,
  opts: FilePickerOptions,
): BoxRenderable {
  const config = loadConfig()
  const container = new BoxRenderable(ctx, {
    id: opts.id,
    flexDirection: "column",
    padding: 1,
  })

  const titleText = new TextRenderable(ctx, {
    id: `${opts.id}-title`,
    content: opts.title,
    fg: "cyan",
  })
  container.add(titleText)

  const files = scanForGgufFiles(config.sourceModelsDir)

  if (files.length === 0) {
    const emptyText = new TextRenderable(ctx, {
      id: `${opts.id}-empty`,
      content: "No GGUF files found in source_models/",
      fg: "yellow",
    })
    container.add(emptyText)
    return container
  }

  const options: SelectOption[] = files.map((f) => ({
    name: `${f.path}  (${formatFileSize(f.size)})`,
    description: f.type.toUpperCase(),
    value: f.path,
  }))

  const select = new SelectRenderable(ctx, {
    id: `${opts.id}-select`,
    options,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: 0,
  })

  select.on("itemSelected", () => {
    const selected = select.getSelectedOption()
    if (selected?.value) {
      opts.onSelect(selected.value)
    }
  })

  const hint = new TextRenderable(ctx, {
    id: `${opts.id}-hint`,
    content: "  Enter: select  |  Esc: back",
    fg: "gray",
  })
  container.add(hint)
  container.add(select)

  return container
}
