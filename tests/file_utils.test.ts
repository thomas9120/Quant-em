import { describe, expect, test } from "bun:test"
import { getGgufLayerCount, formatFileSize, collectImatrixFiles } from "../src/lib/file_utils"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const GGUF_MAGIC = 0x46554747

function writeHeader(metadataKvCount: bigint): Buffer {
  const header = Buffer.alloc(24)
  header.writeUInt32LE(GGUF_MAGIC, 0)
  header.writeUInt32LE(3, 4)
  header.writeBigUInt64LE(0n, 8)
  header.writeBigUInt64LE(metadataKvCount, 16)
  return header
}

function writeMetadataEntry(key: string, valueType: number, value: Buffer): Buffer {
  const keyBytes = Buffer.from(key, "utf-8")
  const keyLen = Buffer.alloc(8)
  keyLen.writeBigUInt64LE(BigInt(keyBytes.length), 0)
  const type = Buffer.alloc(4)
  type.writeUInt32LE(valueType, 0)
  return Buffer.concat([keyLen, keyBytes, type, value])
}

function writeU32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value, 0)
  return buffer
}

function withTempFile(name: string, contents: Buffer, assertion: (filePath: string) => void) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quant-em-gguf-test-"))
  try {
    const filePath = path.join(tempDir, name)
    fs.writeFileSync(filePath, contents)
    assertion(filePath)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

describe("getGgufLayerCount", () => {
  test("reads a valid block_count metadata entry", () => {
    const contents = Buffer.concat([
      writeHeader(1n),
      writeMetadataEntry("llama.block_count", 4, writeU32(32)),
    ])

    withTempFile("valid.gguf", contents, (filePath) => {
      expect(getGgufLayerCount(filePath)).toBe(32)
    })
  })

  test("returns null for oversized metadata counts", () => {
    withTempFile("too-many-kv.gguf", writeHeader(10001n), (filePath) => {
      expect(getGgufLayerCount(filePath)).toBeNull()
    })
  })

  test("returns null for oversized key lengths", () => {
    const keyLen = Buffer.alloc(8)
    keyLen.writeBigUInt64LE(4097n, 0)
    const contents = Buffer.concat([writeHeader(1n), keyLen])

    withTempFile("huge-key.gguf", contents, (filePath) => {
      expect(getGgufLayerCount(filePath)).toBeNull()
    })
  })

  test("returns null for unsupported metadata value types", () => {
    const contents = Buffer.concat([
      writeHeader(1n),
      writeMetadataEntry("llama.some_metadata", 99, Buffer.alloc(0)),
    ])

    withTempFile("unsupported-value.gguf", contents, (filePath) => {
      expect(getGgufLayerCount(filePath)).toBeNull()
    })
  })
})

describe("formatFileSize", () => {
  test("formats common sizes", () => {
    expect(formatFileSize(0)).toBe("0 B")
    expect(formatFileSize(500)).toBe("500.0 B")
    expect(formatFileSize(1024)).toBe("1.0 KB")
    expect(formatFileSize(1024 ** 2)).toBe("1.0 MB")
    expect(formatFileSize(1024 ** 3)).toBe("1.0 GB")
    expect(formatFileSize(1024 ** 4)).toBe("1.0 TB")
  })

  test("clamps past TB instead of printing an undefined unit", () => {
    const result = formatFileSize(1024 ** 5)
    expect(result).not.toContain("undefined")
    expect(result).toMatch(/TB$/)
    expect(formatFileSize(5 * 1024 ** 5)).toMatch(/TB$/)
  })
})

describe("collectImatrixFiles", () => {
  test("includes .gguf, .imatrix, and .dat files but skips others", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quant-em-imatrix-"))
    const sourceDir = path.join(tempRoot, "source")
    const outputDir = path.join(tempRoot, "output")
    fs.mkdirSync(sourceDir, { recursive: true })
    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(path.join(sourceDir, "model.gguf"), "x")
    fs.writeFileSync(path.join(sourceDir, "model.imatrix"), "x")
    fs.writeFileSync(path.join(sourceDir, "old.dat"), "x")
    fs.writeFileSync(path.join(sourceDir, "ignore.txt"), "x")
    fs.writeFileSync(path.join(outputDir, "shared.gguf"), "x")
    try {
      const names = collectImatrixFiles(sourceDir, outputDir)
        .map((f) => f.name)
        .sort()
      expect(names).toEqual(["model.gguf", "model.imatrix", "old.dat", "shared.gguf"])
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
