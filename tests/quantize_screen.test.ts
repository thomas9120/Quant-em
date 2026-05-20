import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createQuantizeScreen, getFailureHints, parsePruneLayers } from "../src/ui/quantize_screen"
import {
  buildQuantizeArgs,
  buildTensorTypeFileContent,
  formatMixedQuantLabel,
  parseLayerQuantRules,
} from "../src/lib/quantization_rules"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

let originalCwd = process.cwd()
let tempDir = ""

function writeFakeGguf(filePath: string, layerCount: number) {
  const key = Buffer.from("test.block_count", "utf-8")
  const header = Buffer.alloc(24)
  header.writeUInt32LE(0x46554747, 0)
  header.writeUInt32LE(3, 4)
  header.writeBigUInt64LE(0n, 8)
  header.writeBigUInt64LE(1n, 16)

  const keyLen = Buffer.alloc(8)
  keyLen.writeBigUInt64LE(BigInt(key.length), 0)

  const valueType = Buffer.alloc(4)
  valueType.writeUInt32LE(4, 0)

  const value = Buffer.alloc(4)
  value.writeUInt32LE(layerCount, 0)

  fs.writeFileSync(filePath, Buffer.concat([header, keyLen, key, valueType, value]))
}

beforeEach(() => {
  originalCwd = process.cwd()
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quant-em-test-"))
  fs.mkdirSync(path.join(tempDir, "source_models"), { recursive: true })
  fs.mkdirSync(path.join(tempDir, "output_models"), { recursive: true })
  writeFakeGguf(path.join(tempDir, "source_models", "tiny.gguf"), 7)
  process.chdir(tempDir)
})

afterEach(() => {
  process.chdir(originalCwd)
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe("quantize screen helpers", () => {
  test("validates prune layers with layer-count bounds", () => {
    expect(parsePruneLayers("", 7)).toMatchObject({ valid: true, layers: [] })
    expect(parsePruneLayers("0, 2, 6", 7)).toMatchObject({ valid: true, layers: ["0", "2", "6"] })
    expect(parsePruneLayers("7", 7)).toMatchObject({ valid: false })
    expect(parsePruneLayers("2,2", 7)).toMatchObject({ valid: false })
    expect(parsePruneLayers("abc", 7)).toMatchObject({ valid: false })
  })

  test("returns actionable failure hints", () => {
    expect(getFailureHints({ exitCode: -1, stderr: "ENOENT" }, "llama-quantize.exe")[0]).toContain("Could not start")
    expect(getFailureHints({ exitCode: 1, stderr: "invalid quant type" }, "llama-quantize.exe")[0]).toContain("quantization type")
  })

  test("validates advanced layer quantization rules", () => {
    expect(parseLayerQuantRules("", 32)).toMatchObject({ valid: true, rules: [] })
    expect(parseLayerQuantRules("0-3=q8_0; 4=Q5_K_M; 5-31=Q4_K_M", 32)).toMatchObject({
      valid: true,
      rules: [
        { startLayer: 0, endLayer: 3, quantType: "Q8_0" },
        { startLayer: 4, endLayer: 4, quantType: "Q5_K_M" },
        { startLayer: 5, endLayer: 31, quantType: "Q4_K_M" },
      ],
    })
    expect(parseLayerQuantRules("4-2=Q8_0", 32)).toMatchObject({ valid: false })
    expect(parseLayerQuantRules("0-4=Q8_0; 4-8=Q5_K_M", 32)).toMatchObject({ valid: false })
    expect(parseLayerQuantRules("5-8=Q8_0; 0-3=Q5_K_M", 32)).toMatchObject({ valid: false })
    expect(parseLayerQuantRules("31-32=Q8_0", 32)).toMatchObject({ valid: false })
    expect(parseLayerQuantRules("0-3=NOPE", 32)).toMatchObject({ valid: false })
  })

  test("builds tensor override file contents and quantize args", () => {
    const rules = parseLayerQuantRules("0=Q8_0; 1-3=Q5_K_M", 4).rules
    expect(buildTensorTypeFileContent(rules)).toBe("blk\\.0\\..*=Q8_0\nblk\\.(1|2|3)\\..*=Q5_K_M")
    expect(buildQuantizeArgs("in.gguf", "out.gguf", "Q4_K_M", 8, [], null)).toEqual([
      "in.gguf",
      "out.gguf",
      "Q4_K_M",
      "8",
    ])
    expect(buildQuantizeArgs("in.gguf", "out.gguf", "Q4_K_M", 8, ["2"], "rules.txt")).toEqual([
      "--prune-layers",
      "2",
      "--tensor-type-file",
      "rules.txt",
      "in.gguf",
      "out.gguf",
      "Q4_K_M",
      "8",
    ])
    expect(formatMixedQuantLabel("Q4_K_M", rules)).toBe("mixed: Q8_0/Q5_K_M; base Q4_K_M")
  })
})

describe("quantize screen render", () => {
  test("shows layer count, output filename, and preview confirmation", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 100, height: 30 })
    renderer.root.add(createQuantizeScreen(renderer))
    await renderOnce()

    let frame = captureCharFrame()
    expect(frame).toContain("Layers: 7 (0-6)")
    expect(frame).toContain("Advanced layer quantization")
    expect(frame).toContain("Output filename:")
    expect(frame).toContain("tiny-Q6_K.gguf")
    expect(frame).not.toContain("Selectasource")

    mockInput.pressEnter()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).toContain("Estimated output size")
    expect(frame).toContain("Layer")
    expect(frame).toContain("none")
    expect(frame).toContain("Press Enter again")

    renderer.destroy()
  })
})
