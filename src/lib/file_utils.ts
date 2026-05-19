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
  if (bytes <= 0) return "0 B"
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

  const dirs: string[] = []

  function walk(currentDir: string, relativePath: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    let hasSafetensors = false
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".safetensors")) {
        hasSafetensors = true
        break
      }
    }
    if (hasSafetensors && relativePath) {
      dirs.push(relativePath)
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(currentDir, entry.name)
        const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name
        walk(subDir, relPath)
      }
    }
  }

  walk(fullDir, "")
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

const GGUF_VALUE_SIZES: Record<number, number> = {
  0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4,
  6: 4, 7: 1, 10: 8, 11: 8, 12: 8, 14: 2,
}

function readU64(fd: number, offset: number): bigint {
  const buf = Buffer.alloc(8)
  fs.readSync(fd, buf, 0, 8, offset)
  return buf.readBigUInt64LE(0)
}

function readU32(fd: number, offset: number): number {
  const buf = Buffer.alloc(4)
  fs.readSync(fd, buf, 0, 4, offset)
  return buf.readUInt32LE(0)
}

function skipGgufValue(fd: number, offset: number, type: number): number | null {
  const fixed = GGUF_VALUE_SIZES[type]
  if (fixed !== undefined) return fixed

  if (type === 8) {
    const len = Number(readU64(fd, offset))
    return 8 + len
  }

  if (type === 9) {
    const elemType = readU32(fd, offset)
    const count = Number(readU64(fd, offset + 4))
    if (elemType === 8) {
      let dataOffset = 12
      for (let i = 0; i < count; i++) {
        const strLen = Number(readU64(fd, offset + dataOffset))
        dataOffset += 8 + strLen
      }
      return dataOffset
    }
    const elemSize = GGUF_VALUE_SIZES[elemType]
    if (elemSize === undefined) return null
    return 12 + count * elemSize
  }

  return null
}

export function getGgufLayerCount(filePath: string): number | null {
  let result: number | null = null
  const MAX_METADATA_KV_COUNT = 10000
  const MAX_KEY_LENGTH = 4096
  const fd = fs.openSync(filePath, "r")
  try {
    const header = Buffer.alloc(24)
    fs.readSync(fd, header, 0, 24, 0)

    if (header.readUInt32LE(0) === GGUF_MAGIC) {
      const metadataKvCount = Number(header.readBigUInt64LE(16))
      if (metadataKvCount > MAX_METADATA_KV_COUNT) return null
      let offset = 24

      for (let i = 0; i < metadataKvCount; i++) {
        const keyLen = Number(readU64(fd, offset))
        if (keyLen > MAX_KEY_LENGTH) return null
        offset += 8

        const keyBuf = Buffer.alloc(keyLen)
        fs.readSync(fd, keyBuf, 0, keyLen, offset)
        const key = keyBuf.toString("utf-8")
        offset += keyLen

        const valueType = readU32(fd, offset)
        offset += 4

        if (key.endsWith(".block_count") && valueType === 4) {
          result = readU32(fd, offset)
          break
        }

        const skip = skipGgufValue(fd, offset, valueType)
        if (skip === null) break
        offset += skip
      }
    }
  } catch {
    result = null
  } finally {
    fs.closeSync(fd)
  }
  return result
}
