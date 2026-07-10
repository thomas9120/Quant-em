import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  type KeyEvent,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, saveConfig, getEffectiveHfToken } from "../lib/config"

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
    { key: "llamaCppPath", label: "llama.cpp binary path:", value: config.llamaCppPath || "" },
    { key: "llamaCppSourcePath", label: "llama.cpp source path:", value: config.llamaCppSourcePath || "" },
    { key: "sourceModelsDir", label: "Source models dir:", value: config.sourceModelsDir },
    { key: "outputModelsDir", label: "Output models dir:", value: config.outputModelsDir },
    { key: "defaultThreads", label: "Default threads:", value: String(config.defaultThreads) },
    { key: "hfToken", label: "HF token:", value: config.hfToken || "" },
  ]
  const detectedHfToken = !config.hfToken && Boolean(getEffectiveHfToken(config))

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

  const getOriginalValues = () => {
    return fields.map((f) => f.value)
  }

  const hasChanges = () => {
    const originals = getOriginalValues()
    return inputs.some((input, i) => input.value !== originals[i])
  }

  let confirmEscapeActive = false
  let confirmEscapeHandler: ((k: KeyEvent) => void) | null = null

  const removeConfirmEscape = () => {
    if (confirmEscapeHandler) {
      renderer.keyInput.off("keypress", confirmEscapeHandler)
      confirmEscapeHandler = null
      confirmEscapeActive = false
      confirmText.content = ""
      confirmText.requestRender()
    }
  }

  const save = () => {
    removeConfirmEscape()

    const values: Record<string, string> = {}
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      const input = inputs[i]
      if (!field || !input) continue
      values[field.key] = input.value
    }

    config.llamaCppPath = values.llamaCppPath || null
    config.llamaCppSourcePath = values.llamaCppSourcePath || null
    config.sourceModelsDir = values.sourceModelsDir || "source_models"
    config.outputModelsDir = values.outputModelsDir || "output_models"

    const parsedThreads = parseInt(values.defaultThreads || "", 10)
    if (!Number.isFinite(parsedThreads) || parsedThreads < 1) {
      statusText.content = "Default threads must be a positive integer (1 or greater)."
      statusText.fg = "red"
      container.requestRender()
      return
    }
    config.defaultThreads = Math.min(parsedThreads, 1024)
    config.hfToken = values.hfToken || null

    saveConfig(config)
    statusText.content = "Settings saved!"
    statusText.fg = "green"
    container.requestRender()

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      const input = inputs[i]
      if (field && input) {
        field.value = input.value
      }
    }
  }

  for (const input of inputs) {
    input.on("enter", () => {
      if (confirmEscapeActive) return
      save()
    })
  }

  let focusedIndex = 0

  const focusCurrentInput = () => {
    for (const input of inputs) {
      input.blur()
    }
    const target = inputs[focusedIndex]
    if (target) {
      target.focus()
    }
  }

  const onKey = (key: KeyEvent) => {
    if (key.name === "escape") {
      if (confirmEscapeActive) {
        removeConfirmEscape()
        return
      }

      if (hasChanges()) {
        confirmText.content = "Press Enter to discard changes, or Esc to keep editing."
        confirmText.requestRender()
        confirmEscapeActive = true
        confirmEscapeHandler = (k: KeyEvent) => {
          if (k.name === "return" || k.name === "enter") {
            removeConfirmEscape()
            popScreen()
          }
          if (k.name === "escape") {
            removeConfirmEscape()
          }
        }
        renderer.keyInput.on("keypress", confirmEscapeHandler)
      } else {
        popScreen()
      }
    }

    if (key.name === "tab") {
      focusedIndex = (focusedIndex + 1) % inputs.length
      focusCurrentInput()
    }
  }
  renderer.keyInput.on("keypress", onKey)
  setCleanup(() => {
    renderer.keyInput.off("keypress", onKey)
    removeConfirmEscape()
  })

  process.nextTick(() => {
    focusCurrentInput()
  })

  return container
}
