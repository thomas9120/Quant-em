import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  type SelectOption,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, resolvePath, saveConfig } from "../lib/config"
import { runProcess } from "../lib/process_runner"
import { findAssetForBackend, type GitHubRelease } from "../lib/setup_release"
import { createProcessPanel } from "./components/process_panel"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"

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

async function downloadFile(url: string, destination: string, onProgress?: (downloaded: number, total: number) => void): Promise<void> {
  const response = await fetch(url, {
    headers: { "User-Agent": "quant-em" },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")

  const contentLength = Number(response.headers.get("content-length") || 0)
  let downloaded = 0
  const file = Bun.file(destination).writer()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      file.write(value)
      downloaded += value.length
      onProgress?.(downloaded, contentLength)
    }
  } finally {
    await file.end()
  }
}

function findFile(dir: string, fileName: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === fileName) return fullPath
    if (entry.isDirectory()) {
      const found = findFile(fullPath, fileName)
      if (found) return found
    }
  }
  return null
}

async function extractArchive(archivePath: string, destination: string, onOutput: (line: string) => void): Promise<void> {
  if (PLATFORM === "win32") {
    const extractResult = await runProcess({
      cmd: "powershell",
      args: [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath ${quotePowerShellLiteral(archivePath)} -DestinationPath ${quotePowerShellLiteral(destination)} -Force`,
      ],
      onOutput,
    })
    if (extractResult.exitCode !== 0) {
      throw new Error(extractResult.stderr || `PowerShell extraction failed with exit code ${extractResult.exitCode}`)
    }
  } else if (archivePath.endsWith(".zip")) {
    const extractResult = await runProcess({
      cmd: "unzip",
      args: ["-q", archivePath, "-d", destination],
      onOutput,
    })
    if (extractResult.exitCode !== 0) {
      throw new Error(extractResult.stderr || `unzip extraction failed with exit code ${extractResult.exitCode}`)
    }
  } else {
    const extractResult = await runProcess({
      cmd: "tar",
      args: ["-xzf", archivePath, "-C", destination],
      onOutput,
    })
    if (extractResult.exitCode !== 0) {
      throw new Error(extractResult.stderr || `tar extraction failed with exit code ${extractResult.exitCode}`)
    }
  }
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

    const freshConfig = loadConfig()

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
        os.tmpdir(),
        asset.name,
      )

      panel.addLine(`Downloading to temp: ${tempFile}`, "gray")

      await downloadFile(asset.browser_download_url, tempFile, (downloaded, contentLength) => {
        const pct = contentLength > 0 ? ((downloaded / contentLength) * 100).toFixed(1) : "?"
        panel.setStatus(`Downloading... ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`)
      })

      panel.addLine("Download complete. Extracting...", "green")

      if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir, { recursive: true })
      }

      await extractArchive(tempFile, installDir, (line) => panel.addLine(line, "white"))

      const quantizeBin = PLATFORM === "win32" ? "llama-quantize.exe" : "llama-quantize"

      const foundBinary = findFile(installDir, quantizeBin)

      panel.addLine("Downloading llama.cpp source for GGUF conversion tools...", "cyan")
      const sourceZip = path.join(os.tmpdir(), `llama.cpp-${release.tag_name}-source.zip`)
      const sourceDir = path.join(installDir, "source")
      await downloadFile(
        `https://github.com/ggml-org/llama.cpp/archive/refs/tags/${encodeURIComponent(release.tag_name)}.zip`,
        sourceZip,
        (downloaded, contentLength) => {
          const pct = contentLength > 0 ? ((downloaded / contentLength) * 100).toFixed(1) : "?"
          panel.setStatus(`Downloading source... ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`)
        },
      )
      fs.rmSync(sourceDir, { recursive: true, force: true })
      fs.mkdirSync(sourceDir, { recursive: true })
      await extractArchive(sourceZip, sourceDir, (line) => panel.addLine(line, "white"))
      const foundConvertScript = findFile(sourceDir, "convert_hf_to_gguf.py")
      const foundSourcePath = foundConvertScript ? path.dirname(foundConvertScript) : null

      if (foundBinary) {
        const binaryDir = path.dirname(foundBinary)
        freshConfig.llamaCppPath = binaryDir
        freshConfig.llamaCppSourcePath = foundSourcePath
        freshConfig.llamaCppVersion = release.tag_name
        freshConfig.backend = backend as any
        saveConfig(freshConfig)

        panel.addLine("", "white")
        panel.addLine("Installation complete!", "green")
        panel.addLine(`Binary: ${foundBinary}`, "green")
        if (foundSourcePath) {
          panel.addLine(`Conversion source: ${foundSourcePath}`, "green")
        } else {
          panel.addLine("Warning: convert_hf_to_gguf.py was not found in the source archive", "yellow")
        }
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
        fs.unlinkSync(sourceZip)
      } catch {}
    } catch (err: any) {
      panel.setStatus("Failed")
      panel.addLine(`Error: ${err.message}`, "red")
    }

    installing = false
  }

  const onKey = (key: any) => {
    if (key.name === "escape") {
      popScreen()
      return
    }

    if (key.name === "return" || key.name === "enter") {
      startInstall()
    }
  }
  renderer.keyInput.on("keypress", onKey)
  setCleanup(() => renderer.keyInput.off("keypress", onKey))

  process.nextTick(() => {
    backendSelect.focus()
  })

  return container
}
