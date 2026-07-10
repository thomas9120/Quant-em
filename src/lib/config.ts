import { DEFAULT_CONFIG, type QuantEmConfig } from "../types"
import * as path from "path"
import * as fs from "fs"
import { fileURLToPath } from "url"

const CONFIG_FILENAME = "quant-em-config.json"
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function resolveProjectRoot(): string {
  if (process.env.QUANT_EM_PROJECT_ROOT) {
    return path.resolve(process.env.QUANT_EM_PROJECT_ROOT)
  }
  return PROJECT_ROOT
}

function getHomeDir(): string | null {
  return process.env.HOME || process.env.USERPROFILE || null
}

function readTokenFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const token = fs.readFileSync(filePath, "utf-8").trim()
    return token || null
  } catch {
    return null
  }
}

function detectHfToken(): string | null {
  const envToken = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN
  if (envToken?.trim()) return envToken.trim()

  const homeDir = getHomeDir()
  const tokenPaths = [
    process.env.HF_TOKEN_PATH,
    process.env.HF_HOME ? path.join(process.env.HF_HOME, "token") : null,
    homeDir ? path.join(homeDir, ".cache", "huggingface", "token") : null,
  ].filter((value): value is string => Boolean(value))

  for (const tokenPath of tokenPaths) {
    const token = readTokenFile(tokenPath)
    if (token) return token
  }

  return null
}

export function getConfigPath(): string {
  return path.join(resolveProjectRoot(), CONFIG_FILENAME)
}

export function loadConfig(): QuantEmConfig {
  const configPath = getConfigPath()
  let config: QuantEmConfig = { ...DEFAULT_CONFIG }
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8")
      const parsed = JSON.parse(raw)
      config = { ...DEFAULT_CONFIG, ...parsed }
    }
  } catch (err: unknown) {
    console.warn(`Warning: Could not load config from ${configPath}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!Array.isArray(config.quantizationHistory)) {
    config.quantizationHistory = []
  }
  if (typeof config.defaultThreads !== "number" || !Number.isFinite(config.defaultThreads)) {
    config.defaultThreads = DEFAULT_CONFIG.defaultThreads
  }

  return config
}

export function getEffectiveHfToken(config: QuantEmConfig): string | null {
  return config.hfToken || detectHfToken()
}

export function saveConfig(config: QuantEmConfig): void {
  const configPath = getConfigPath()
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")
}

export function resolvePath(dir: string): string {
  if (path.isAbsolute(dir)) return dir
  return path.join(resolveProjectRoot(), dir)
}

export function ensureDir(dir: string): void {
  const full = resolvePath(dir)
  if (!fs.existsSync(full)) {
    fs.mkdirSync(full, { recursive: true })
  }
}
