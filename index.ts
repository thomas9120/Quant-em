import { createCliRenderer } from "@opentui/core"
import { initNavigator } from "./src/ui/navigator"
import { createMainMenuScreen } from "./src/ui/main_menu"
import { loadConfig, ensureDir } from "./src/lib/config"

async function main() {
  const config = loadConfig()
  ensureDir(config.sourceModelsDir)
  ensureDir(config.outputModelsDir)

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    screenMode: "alternate-screen",
    targetFps: 30,
    enableMouseMovement: true,
    useMouse: true,
    backgroundColor: "#1a1a2e",
  })

  renderer.setTerminalTitle("Quant-em")
  renderer.start()

  initNavigator(renderer, createMainMenuScreen)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
