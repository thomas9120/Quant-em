import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  InputRenderable,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, saveConfig } from "../lib/config"

export function createSettingsScreen(renderer: CliRenderer): BoxRenderable {
  const ctx = renderer
  const config = loadConfig()

  const container = new BoxRenderable(ctx, {
    id: "settings-screen",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    padding: 1,
  })

  const title = new TextRenderable(ctx, {
    id: "settings-title",
    content: "=== Settings ===",
    fg: "cyan",
  })
  container.add(title)

  const fields = [
    { key: "llamaCppPath", label: "llama.cpp path:", value: config.llamaCppPath || "" },
    { key: "sourceModelsDir", label: "Source models dir:", value: config.sourceModelsDir },
    { key: "outputModelsDir", label: "Output models dir:", value: config.outputModelsDir },
    { key: "defaultThreads", label: "Default threads:", value: String(config.defaultThreads) },
    { key: "hfToken", label: "HF token:", value: config.hfToken || "" },
  ]
  const detectedHfToken = Boolean(config.hfToken)

  const inputs: InputRenderable[] = []

  for (const field of fields) {
    const label = new TextRenderable(ctx, {
      id: `settings-label-${field.key}`,
      content: field.label,
      fg: "white",
      marginTop: 1,
    })
    container.add(label)

    const input = new InputRenderable(ctx, {
      id: `settings-input-${field.key}`,
      value: field.value,
      placeholder: field.key === "hfToken" ? "hf_xxxx..." : "",
      textColor: "white",
    })
    container.add(input)
    inputs.push(input)

    if (field.key === "hfToken" && detectedHfToken) {
      const detectedText = new TextRenderable(ctx, {
        id: "settings-hf-token-detected",
        content: "Detected from saved Hugging Face credentials or environment.",
        fg: "gray",
      })
      container.add(detectedText)
    }
  }

  const statusText = new TextRenderable(ctx, {
    id: "settings-status",
    content: "",
    fg: "green",
    marginTop: 2,
  })
  container.add(statusText)

  const confirmText = new TextRenderable(ctx, {
    id: "settings-confirm",
    content: "",
    fg: "yellow",
  })
  container.add(confirmText)

  const hintText = new TextRenderable(ctx, {
    id: "settings-hint",
    content: "Enter: save  |  Esc: back (discard)",
    fg: "gray",
  })
  container.add(hintText)

  const save = () => {
    const values: Record<string, string> = {}
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      const input = inputs[i]
      if (!field || !input) continue
      values[field.key] = input.value
    }

    config.llamaCppPath = values.llamaCppPath || null
    config.sourceModelsDir = values.sourceModelsDir || "source_models"
    config.outputModelsDir = values.outputModelsDir || "output_models"
    config.defaultThreads = parseInt(values.defaultThreads || "") || 8
    config.hfToken = values.hfToken || null

    saveConfig(config)
    statusText.content = "Settings saved!"
    container.requestRender()
  }

  for (const input of inputs) {
    input.on("enter", () => save())
  }

  const onKey = (key: any) => {
    if (key.name === "escape") {
      const hasChanges = inputs.some((input, i) => {
        const field = fields[i]
        return field && input.value !== (field.key === "llamaCppPath" || field.key === "hfToken"
          ? (config as any)[field.key] || ""
          : (config as any)[field.key] || "")
      })
      if (hasChanges) {
        confirmText.content = "Press Enter again to discard changes, or Esc to keep editing."
        confirmText.requestRender()
        const confirmEscape = (k: any) => {
          if (k.name === "enter") {
            renderer.keyInput.off("keypress", confirmEscape)
            popScreen()
          }
          if (k.name === "escape") {
            renderer.keyInput.off("keypress", confirmEscape)
            confirmText.content = ""
          }
        }
        renderer.keyInput.on("keypress", confirmEscape)
      } else {
        popScreen()
      }
    }
  }
  renderer.keyInput.on("keypress", onKey)
  setCleanup(() => renderer.keyInput.off("keypress", onKey))

  return container
}
