import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  type SelectOption,
} from "@opentui/core"
import { createHeader } from "./components/header"
import { createStatusBar } from "./components/status_bar"
import { pushScreen } from "./navigator"
import { createQuantizeScreen } from "./quantize_screen"
import { createDownloadScreen } from "./download_screen"
import { createConvertScreen } from "./convert_screen"
import { createAnalyzeProfileScreen } from "./analyze_profile_screen"
import { createSetupScreen } from "./setup_screen"
import { createSettingsScreen } from "./settings_screen"

export function createMainMenuScreen(renderer: CliRenderer): BoxRenderable {
  const ctx = renderer

  const container = new BoxRenderable(ctx, {
    id: "main-menu",
    flexDirection: "column",
    height: "100%",
    width: "100%",
  })

  const header = createHeader(ctx)
  container.add(header)

  const menuOptions: SelectOption[] = [
    { name: "Download Model", description: "Download models from HuggingFace", value: "download" },
    { name: "Convert to GGUF", description: "Convert safetensors to GGUF format", value: "convert" },
    { name: "Quantize Model", description: "Quantize a GGUF model", value: "quantize" },
    { name: "Analyze GGUF Profile", description: "Extract a reusable quantization profile from a GGUF", value: "analyze-profile" },
    { name: "Setup", description: "Install llama.cpp, HF CLI, or converter deps", value: "setup" },
    { name: "Settings", description: "Configure paths and defaults", value: "settings" },
    { name: "Exit", description: "Quit Quant-em", value: "exit" },
  ]

  const select = new SelectRenderable(ctx, {
    id: "main-menu-select",
    options: menuOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: 0,
    itemSpacing: 1,
    flexGrow: 1,
  })

  select.on("itemSelected", () => {
    const selected = select.getSelectedOption()
    if (!selected?.value) return

    switch (selected.value) {
      case "download":
        pushScreen(createDownloadScreen)
        break
      case "convert":
        pushScreen(createConvertScreen)
        break
      case "quantize":
        pushScreen(createQuantizeScreen)
        break
      case "analyze-profile":
        pushScreen(createAnalyzeProfileScreen)
        break
      case "setup":
        pushScreen(createSetupScreen)
        break
      case "settings":
        pushScreen(createSettingsScreen)
        break
      case "exit":
        renderer.destroy()
        process.exit(0)
    }
  })

  const spacer = new TextRenderable(ctx, {
    id: "menu-spacer",
    content: "",
    height: 1,
  })
  container.add(spacer)
  container.add(select)

  const statusBar = createStatusBar(ctx)
  container.add(statusBar)

  process.nextTick(() => {
    select.focus()
  })

  return container
}
