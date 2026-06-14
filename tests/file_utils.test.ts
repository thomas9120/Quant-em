import { describe, expect, test } from "bun:test"
import { getGgufLayerCount } from "../src/lib/file_utils"
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
