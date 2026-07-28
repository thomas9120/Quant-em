import type { CliRenderer } from "@opentui/core"
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  type SelectOption,
  type KeyEvent,
} from "@opentui/core"
import { popScreen, setCleanup } from "./navigator"
import { loadConfig, resolvePath, saveConfig } from "../lib/config"
import { runProcess } from "../lib/process_runner"
import { findAssetForBackend, type GitHubRelease } from "../lib/setup_release"
import { installProjectHfCli } from "../lib/hf_cli"
import { installConvertDependencies } from "../lib/convert_tool"
import { createProcessPanel } from "./components/process_panel"
import type { QuantEmConfig } from "../types"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"

type Backend = NonNullable<QuantEmConfig["backend"]>
const BACKEND_VALUES: ReadonlySet<Backend> = new Set<Backend>(["cpu", "cuda-12", "cuda-13", "vulkan"])
function isBackend(value: string): value is Backend {
  return BACKEND_VALUES.has(value as Backend)
}

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

const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000

function readChunkWithIdleTimeout(
  reader: { read(): Promise<{ done: boolean; value?: Uint8Array | undefined }> },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ done: boolean; value?: Uint8Array }> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (signal) signal.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(signal?.reason ?? new Error("Download aborted"))
    }

    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Download aborted"))
      return
    }
    if (signal) signal.addEventListener("abort", onAbort, { once: true })

    timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Download stalled: no data for ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    reader.read().then(
      (result) => {
        cleanup()
        resolve(result)
      },
      (err: unknown) => {
        cleanup()
        reject(err)
      },
    )
  })
}

async function downloadFile(url: string, destination: string, onProgress?: (downloaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(url, {
    headers: { "User-Agent": "quant-em" },
    signal,
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
      const { done, value } = await readChunkWithIdleTimeout(reader, DOWNLOAD_IDLE_TIMEOUT_MS, signal)
      if (done || !value) break
      file.write(value)
      downloaded += value.length
      onProgress?.(downloaded, contentLength)
    }
  } finally {
    reader.cancel().catch(() => {})
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

async function extractArchive(archivePath: string, destination: string, onOutput: (line: string) => void, signal?: AbortSignal): Promise<void> {
  let cmd: string
  let args: string[]
  let label: string
  if (PLATFORM === "win32") {
    cmd = "powershell"
    args = [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath ${quotePowerShellLiteral(archivePath)} -DestinationPath ${quotePowerShellLiteral(destination)} -Force`,
    ]
    label = "PowerShell"
  } else if (archivePath.endsWith(".zip")) {
    cmd = "unzip"
    args = ["-q", archivePath, "-d", destination]
    label = "unzip"
  } else {
    cmd = "tar"
    args = ["-xzf", archivePath, "-C", destination]
    label = "tar"
  }

  const { result, abort } = runProcess({ cmd, args, onOutput })
  const onAbort = () => abort()
  if (signal) {
    if (signal.aborted) {
      abort()
    } else {
      signal.addEventListener("abort", onAbort, { once: true })
    }
  }
  try {
    const extractResult = await result
    if (extractResult.exitCode !== 0) {
      throw new Error(extractResult.stderr || `${label} extraction failed with exit code ${extractResult.exitCode}`)
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort)
  }
}

async function getLatestRelease(signal?: AbortSignal): Promise<GitHubRelease | null> {
  try {
    const resp = await fetch("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", {
      headers: { "User-Agent": "quant-em" },
      signal,
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
    content: "=== Setup ===",
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
    content: "Select install target:",
    fg: "white",
    marginTop: 1,
  })
  container.add(backendLabel)

  const backendOptions: SelectOption[] = [
    { name: "CPU", description: "llama.cpp CPU only (works everywhere)", value: "cpu" },
    { name: "CUDA 12", description: "llama.cpp NVIDIA GPU with CUDA 12.x", value: "cuda-12" },
    { name: "CUDA 13", description: "llama.cpp NVIDIA GPU with CUDA 13.x", value: "cuda-13" },
    { name: "Vulkan", description: "llama.cpp Vulkan GPU acceleration", value: "vulkan" },
    { name: "HuggingFace CLI", description: "Create .venv and install hf download tool", value: "hf-cli" },
    { name: "GGUF converter deps", description: "Install Python packages for safetensors → GGUF", value: "convert-deps" },
  ]

  const backendSelect = new SelectRenderable(ctx, {
    id: "backend-select",
    height: 12,
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
  let abortController: AbortController | null = null

  const startHfCliInstall = async () => {
    installing = true
    panel.clear()
    panel.setStatus("Installing HuggingFace CLI...")
    panel.addLine("Creating project .venv and installing huggingface_hub[cli]...", "cyan")

    const result = await installProjectHfCli((line, stream) => {
      panel.addLine(line, stream === "stderr" ? "yellow" : "white")
    })

    if (result.ok && result.hfPath) {
      panel.addLine("", "white")
      panel.addLine("HuggingFace CLI installed!", "green")
      panel.addLine(`hf: ${result.hfPath}`, "green")
      panel.setStatus("Installed!")
    } else {
      panel.setStatus("Failed")
      panel.addLine(result.error || "HuggingFace CLI install failed", "red")
    }

    installing = false
  }

  const startConvertDepsInstall = async () => {
    installing = true
    panel.clear()
    panel.setStatus("Installing GGUF converter deps...")
    panel.addLine("Installing llama.cpp convert_hf_to_gguf requirements into .venv...", "cyan")
    panel.addLine("Includes torch — this can take a while and use several GB.", "yellow")

    const result = await installConvertDependencies((line, stream) => {
      panel.addLine(line, stream === "stderr" ? "yellow" : "white")
    })

    if (result.ok) {
      panel.addLine("", "white")
      panel.addLine("GGUF converter dependencies installed!", "green")
      if (result.requirementsPath) {
        panel.addLine(`From: ${result.requirementsPath}`, "green")
      }
      panel.setStatus("Installed!")
    } else {
      panel.setStatus("Failed")
      panel.addLine(result.error || "Converter dependency install failed", "red")
    }

    installing = false
  }

  const startInstall = async () => {
    if (installing) return

    const selectedValue = backendSelect.getSelectedOption()?.value as string
    if (!selectedValue) return

    if (selectedValue === "hf-cli") {
      await startHfCliInstall()
      return
    }

    if (selectedValue === "convert-deps") {
      await startConvertDepsInstall()
      return
    }

    if (!isBackend(selectedValue)) return
    const backend: Backend = selectedValue

    const freshConfig = loadConfig()

    installing = true
    abortController = new AbortController()
    const signal = abortController.signal
    panel.clear()
    panel.setStatus("Fetching latest release...")
    panel.addLine("Fetching latest llama.cpp release info...", "cyan")

    const release = await getLatestRelease(signal)
    if (!release) {
      if (!signal.aborted) {
        panel.setStatus("Failed")
        panel.addLine("Error: Could not fetch release info from GitHub", "red")
        panel.addLine("Check your internet connection", "yellow")
      }
      installing = false
      abortController = null
      return
    }

    panel.addLine(`Latest release: ${release.tag_name}`, "green")

    const asset = findAssetForBackend(release, backend)
    if (!asset) {
      panel.setStatus("Failed")
      panel.addLine(`Error: No matching release asset found for ${backend} on ${getPlatformLabel()}`, "red")
      installing = false
      abortController = null
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
      }, signal)

      panel.addLine("Download complete. Extracting...", "green")

      if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir, { recursive: true })
      }

      await extractArchive(tempFile, installDir, (line) => panel.addLine(line, "white"), signal)

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
        signal,
      )
      fs.rmSync(sourceDir, { recursive: true, force: true })
      fs.mkdirSync(sourceDir, { recursive: true })
      await extractArchive(sourceZip, sourceDir, (line) => panel.addLine(line, "white"), signal)
      const foundConvertScript = findFile(sourceDir, "convert_hf_to_gguf.py")
      const foundSourcePath = foundConvertScript ? path.dirname(foundConvertScript) : null

      if (foundBinary) {
        const binaryDir = path.dirname(foundBinary)
        freshConfig.llamaCppPath = binaryDir
        freshConfig.llamaCppSourcePath = foundSourcePath
        freshConfig.llamaCppVersion = release.tag_name
        freshConfig.backend = backend
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
    } catch (err: unknown) {
      if (!signal.aborted) {
        panel.setStatus("Failed")
        panel.addLine(`Error: ${err instanceof Error ? err.message : String(err)}`, "red")
      }
    }

    installing = false
    abortController = null
  }

  const onKey = (key: KeyEvent) => {
    if (key.name === "escape") {
      if (abortController) {
        abortController.abort()
        abortController = null
      }
      popScreen()
      return
    }

    if (key.name === "return" || key.name === "enter") {
      startInstall()
    }
  }
  renderer.keyInput.on("keypress", onKey)
  setCleanup(() => {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    renderer.keyInput.off("keypress", onKey)
  })

  process.nextTick(() => {
    backendSelect.focus()
  })

  return container
}
