import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  InputRenderable,
  type SelectOption,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, resolvePath, saveConfig } from "../lib/config"
import { runProcess, checkCommandExists } from "../lib/process_runner"
import { createProcessPanel } from "./components/process_panel"
import * as path from "path"
import * as fs from "fs"

const PLATFORM = process.platform
const ARCH = process.arch

function getPlatformLabel(): string {
  if (PLATFORM === "win32" && ARCH === "x64") return "Windows x64"
  if (PLATFORM === "linux" && ARCH === "x64") return "Linux x64"
  if (PLATFORM === "darwin" && ARCH === "arm64") return "macOS ARM64"
  return `${PLATFORM} ${ARCH}`
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GitHubRelease {
  tag_name: string
  assets: ReleaseAsset[]
}

async function getLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const resp = await fetch("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", {
      headers: { "User-Agent": "quant-em" },
    })
    if (!resp.ok) return null
    return (await resp.json()) as GitHubRelease
  } catch {
    return null
  }
}

function findAssetForBackend(release: GitHubRelease, backend: string): ReleaseAsset | null {
  const platformPatterns: Record<string, string[]> = {
    "win32-x64": ["-bin-win-"],
    "linux-x64": ["-bin-ubuntu-"],
    "darwin-arm64": ["-bin-macos-arm64"],
  }

  const backendPatterns: Record<string, string[]> = {
    cpu: ["-cpu-", "-ubuntu-x64.", "-macos-arm64."],
    "cuda-12": ["-cuda-12."],
    "cuda-13": ["-cuda-13."],
    vulkan: ["-vulkan-"],
  }

  const platformKey = `${PLATFORM}-${ARCH}`
  const platPats = platformPatterns[platformKey] || []
  const backPats = backendPatterns[backend] || []

  for (const asset of release.assets) {
    const name = asset.name.toLowerCase()
    const isLlamaBinary = name.startsWith("llama-") && name.includes("-bin-")
    const matchesPlatform = platPats.some((p) => name.includes(p))
    const matchesBackend = backPats.some((p) => name.includes(p))
    const matchesArchive = PLATFORM === "win32" ? name.endsWith(".zip") : name.endsWith(".tar.gz")
    if (isLlamaBinary && matchesPlatform && matchesBackend && matchesArchive) {
      return asset
    }
  }

  return null
}

export function createSetupScreen(renderer: CliRenderer): BoxRenderable {
  const ctx = renderer

  const container = new BoxRenderable(ctx, {
    id: "setup-screen",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    padding: 1,
  })

  const title = new TextRenderable(ctx, {
    id: "setup-title",
    content: "=== Setup llama.cpp ===",
    fg: "cyan",
  })
  container.add(title)

  const platformInfo = new TextRenderable(ctx, {
    id: "platform-info",
    content: `Detected platform: ${getPlatformLabel()}`,
    fg: "white",
  })
  container.add(platformInfo)

  const config = loadConfig()
  if (config.llamaCppVersion) {
    const installedInfo = new TextRenderable(ctx, {
      id: "installed-info",
      content: `Currently installed: llama.cpp ${config.llamaCppVersion}`,
      fg: "green",
    })
    container.add(installedInfo)
  }

  const backendLabel = new TextRenderable(ctx, {
    id: "backend-label",
    content: "Select backend:",
    fg: "white",
    marginTop: 1,
  })
  container.add(backendLabel)

  const backendOptions: SelectOption[] = [
    { name: "CPU", description: "CPU only (works everywhere)", value: "cpu" },
    { name: "CUDA 12", description: "NVIDIA GPU with CUDA 12.x", value: "cuda-12" },
    { name: "CUDA 13", description: "NVIDIA GPU with CUDA 13.x", value: "cuda-13" },
    { name: "Vulkan", description: "Vulkan GPU acceleration", value: "vulkan" },
  ]

  const backendSelect = new SelectRenderable(ctx, {
    id: "backend-select",
    height: 8,
    options: backendOptions,
    backgroundColor: "black",
    textColor: "white",
    focusedBackgroundColor: "black",
    focusedTextColor: "white",
    selectedBackgroundColor: "cyan",
    selectedTextColor: "black",
    selectedDescriptionColor: "black",
    selectedIndex: 0,
    showDescription: true,
  })
  container.add(backendSelect)

  const panel = createProcessPanel(ctx, "setup-panel")
  container.add(panel.container)

  const hintText = new TextRenderable(ctx, {
    id: "setup-hint",
    content: "Enter: install  |  Esc: back",
    fg: "gray",
  })
  container.add(hintText)

  let installing = false

  const startInstall = async () => {
    if (installing) return

    const backend = backendSelect.getSelectedOption()?.value as string
    if (!backend) return

    installing = true
    panel.clear()
    panel.setStatus("Fetching latest release...")
    panel.addLine("Fetching latest llama.cpp release info...", "cyan")

    const release = await getLatestRelease()
    if (!release) {
      panel.setStatus("Failed")
      panel.addLine("Error: Could not fetch release info from GitHub", "red")
      panel.addLine("Check your internet connection", "yellow")
      installing = false
      return
    }

    panel.addLine(`Latest release: ${release.tag_name}`, "green")

    const asset = findAssetForBackend(release, backend)
    if (!asset) {
      panel.setStatus("Failed")
      panel.addLine(`Error: No matching release asset found for ${backend} on ${getPlatformLabel()}`, "red")
      installing = false
      return
    }

    panel.addLine(`Downloading: ${asset.name}`, "cyan")
    panel.addLine(`Size: ${(asset.size / 1024 / 1024).toFixed(1)} MB`, "white")
    panel.setStatus("Downloading...")

    const installDir = resolvePath(path.join("llama_cpp", release.tag_name))

    try {
      const tempFile = path.join(
        process.env.TEMP || "/tmp",
        asset.name,
      )

      panel.addLine(`Downloading to temp: ${tempFile}`, "gray")

      const response = await fetch(asset.browser_download_url, {
        headers: { "User-Agent": "quant-em" },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error("No response body")

      const contentLength = Number(response.headers.get("content-length") || 0)
      let downloaded = 0
      const file = Bun.file(tempFile).writer()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          file.write(value)
          downloaded += value.length
          const pct = contentLength > 0 ? ((downloaded / contentLength) * 100).toFixed(1) : "?"
          panel.setStatus(`Downloading... ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`)
        }
      } finally {
        await file.end()
      }

      panel.addLine("Download complete. Extracting...", "green")

      if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir, { recursive: true })
      }

      if (PLATFORM === "win32") {
        const extractResult = await runProcess({
          cmd: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            `Expand-Archive -LiteralPath ${quotePowerShellLiteral(tempFile)} -DestinationPath ${quotePowerShellLiteral(installDir)} -Force`,
          ],
          onOutput: (line) => panel.addLine(line, "white"),
        })
        if (extractResult.exitCode !== 0) {
          throw new Error(extractResult.stderr || `PowerShell extraction failed with exit code ${extractResult.exitCode}`)
        }
      } else {
        const extractResult = await runProcess({
          cmd: "unzip",
          args: ["-o", tempFile, "-d", installDir],
          onOutput: (line) => panel.addLine(line, "white"),
        })
        if (extractResult.exitCode !== 0) {
          throw new Error(extractResult.stderr || `unzip failed with exit code ${extractResult.exitCode}`)
        }
      }

      const quantizeBin = PLATFORM === "win32" ? "llama-quantize.exe" : "llama-quantize"

      function findBinary(dir: string): string | null {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isFile() && entry.name === quantizeBin) return fullPath
          if (entry.isDirectory()) {
            const found = findBinary(fullPath)
            if (found) return found
          }
        }
        return null
      }

      const foundBinary = findBinary(installDir)

      if (foundBinary) {
        const binaryDir = path.dirname(foundBinary)
        config.llamaCppPath = binaryDir
        config.llamaCppVersion = release.tag_name
        config.backend = backend as any
        saveConfig(config)

        panel.addLine("", "white")
        panel.addLine("Installation complete!", "green")
        panel.addLine(`Binary: ${foundBinary}`, "green")
        panel.addLine(`Version: ${release.tag_name}`, "green")
        panel.addLine(`Backend: ${backend}`, "green")
        panel.setStatus("Installed!")
      } else {
        panel.addLine("", "white")
        panel.addLine(`Warning: Could not find ${quantizeBin} in extracted files`, "yellow")
        panel.addLine("You may need to set the path manually in Settings", "yellow")
        panel.setStatus("Partial")
      }

      try {
        fs.unlinkSync(tempFile)
      } catch {}
    } catch (err: any) {
      panel.setStatus("Failed")
      panel.addLine(`Error: ${err.message}`, "red")
    }

    installing = false
  }

  backendSelect.on("itemSelected", () => startInstall())

  const onKey = (key: any) => {
    if (key.name === "escape") popScreen()
  }
  renderer.keyInput.on("keypress", onKey)
  setCleanup(() => renderer.keyInput.off("keypress", onKey))

  process.nextTick(() => {
    backendSelect.focus()
  })

  return container
}
