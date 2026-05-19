import { DEFAULT_CONFIG, type QuantEmConfig } from "../types"
import * as path from "path"
import * as fs from "fs"

const CONFIG_FILENAME = "quant-em-config.json"

function resolveProjectRoot(): string {
  return process.cwd()
}

export function getConfigPath(): string {
  return path.join(resolveProjectRoot(), CONFIG_FILENAME)
}

export function loadConfig(): QuantEmConfig {
  const configPath = getConfigPath()
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8")
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_CONFIG, ...parsed }
    }
  } catch {
  }
  return { ...DEFAULT_CONFIG }
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
