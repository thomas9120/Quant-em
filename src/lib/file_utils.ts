import * as fs from "fs"
import * as path from "path"
import { resolvePath } from "./config"
import type { ModelFile } from "../types"

const GGUF_MAGIC = 0x46475547

export function detectFileType(filePath: string): "gguf" | "safetensors" | "unknown" {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".gguf") return "gguf"
  if (ext === ".safetensors") return "safetensors"

  try {
    const fd = fs.openSync(filePath, "r")
    const buf = Buffer.alloc(4)
    fs.readSync(fd, buf, 0, 4, 0)
    fs.closeSync(fd)
    if (buf.readUInt32LE(0) === GGUF_MAGIC) return "gguf"
  } catch {
  }

  return "unknown"
}

export function getFileSize(filePath: string): number {
  try {
    const stat = fs.statSync(filePath)
    return stat.size
  } catch {
    return 0
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const val = bytes / Math.pow(1024, i)
  return `${val.toFixed(1)} ${units[i]}`
}

export function scanForFiles(dir: string, extensions?: string[]): ModelFile[] {
  const fullDir = resolvePath(dir)
  const results: ModelFile[] = []

  if (!fs.existsSync(fullDir)) return results

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (extensions && extensions.length > 0) {
          if (!extensions.includes(ext)) continue
        }
        const fileType = detectFileType(fullPath)
        results.push({
          name: entry.name,
          path: path.relative(fullDir, fullPath),
          size: getFileSize(fullPath),
          type: fileType,
        })
      }
    }
  }

  walk(fullDir)
  return results.sort((a, b) => a.path.localeCompare(b.path))
}

export function scanForGgufFiles(dir: string): ModelFile[] {
  return scanForFiles(dir, [".gguf"])
}

export function scanForSafetensorsDirs(dir: string): string[] {
  const fullDir = resolvePath(dir)
  if (!fs.existsSync(fullDir)) return []

  const entries = fs.readdirSync(fullDir, { withFileTypes: true })
  const dirs: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const subDir = path.join(fullDir, entry.name)
    const files = fs.readdirSync(subDir)
    if (files.some((f) => f.endsWith(".safetensors"))) {
      dirs.push(entry.name)
    }
  }

  return dirs.sort()
}

export function listSubdirs(dir: string): string[] {
  const fullDir = resolvePath(dir)
  if (!fs.existsSync(fullDir)) return []

  return fs
    .readdirSync(fullDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(resolvePath(filePath))
  } catch {
    return false
  }
}
