import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createConvertScreen } from "../src/ui/convert_screen"
import { createQuantizeScreen, getFailureHints, parsePruneLayers } from "../src/ui/quantize_screen"
import {
  buildQuantizeArgs,
  buildTensorTypeFileContent,
  formatMixedQuantLabel,
  parseLayerQuantRules,
} from "../src/lib/quantization_rules"
import {
  buildProfileTensorTypeFileContent,
  parseQuantizationProfileJson,
  profileHasUnknownQuantTypes,
} from "../src/lib/quantization_profiles"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

let originalCwd = process.cwd()
let originalProjectRoot = process.env.QUANT_EM_PROJECT_ROOT
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
  fs.mkdirSync(path.join(tempDir, "source_models", "gemma-4-31B-it-qat-q4_0-unquantized-heretic"), { recursive: true })
  fs.mkdirSync(path.join(tempDir, "source_models", "llama-test-model"), { recursive: true })
  fs.writeFileSync(path.join(tempDir, "source_models", "gemma-4-31B-it-qat-q4_0-unquantized-heretic", "model-00001-of-00002.safetensors"), "")
  fs.writeFileSync(path.join(tempDir, "source_models", "llama-test-model", "model.safetensors"), "")
  process.env.QUANT_EM_PROJECT_ROOT = tempDir
  process.chdir(tempDir)
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalProjectRoot === undefined) {
    delete process.env.QUANT_EM_PROJECT_ROOT
  } else {
    process.env.QUANT_EM_PROJECT_ROOT = originalProjectRoot
  }
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

  test("accepts additional llama.cpp quantization types", () => {
    expect(parseLayerQuantRules("0=Q4_0; 1=Q2_K; 2=NVFP4", 4)).toMatchObject({
      valid: true,
      rules: [
        { startLayer: 0, endLayer: 0, quantType: "Q4_0" },
        { startLayer: 1, endLayer: 1, quantType: "Q2_K" },
        { startLayer: 2, endLayer: 2, quantType: "NVFP4" },
      ],
    })
    expect(parseLayerQuantRules("0=COPY", 4)).toMatchObject({ valid: false })

    const profile = parseQuantizationProfileJson(JSON.stringify({
      profileVersion: 1,
      name: "Legacy Quant Profile",
      baseQuantType: "nvfp4",
      rules: [
        { pattern: "^blk\\.0\\..*$", type: "q5_1" },
        { pattern: "^blk\\.1\\..*$", type: "bf16" },
      ],
    }))

    expect(profile.valid).toBe(true)
    expect(profile.profile).toMatchObject({
      baseQuantType: "NVFP4",
      rules: [
        { pattern: "^blk\\.0\\..*$", type: "Q5_1" },
        { pattern: "^blk\\.1\\..*$", type: "BF16" },
      ],
    })

    expect(parseQuantizationProfileJson(JSON.stringify({
      profileVersion: 1,
      name: "Bad Tensor Copy",
      baseQuantType: "COPY",
      rules: [{ pattern: "^blk\\.0\\..*$", type: "COPY" }],
    })).valid).toBe(false)
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
    expect(buildQuantizeArgs("in.gguf", "out.gguf", "IQ2_XXS", 8, [], null, {
      imatrixFile: "imatrix.gguf",
    })).toEqual([
      "--imatrix",
      "imatrix.gguf",
      "in.gguf",
      "out.gguf",
      "IQ2_XXS",
      "8",
    ])
    expect(formatMixedQuantLabel("Q4_K_M", rules)).toBe("mixed: Q8_0/Q5_K_M; base Q4_K_M")
  })

  test("validates quantization profiles and builds profile args", () => {
    const validation = parseQuantizationProfileJson(JSON.stringify({
      profileVersion: 1,
      name: "Profile One",
      baseQuantType: "q4_k_m",
      tokenEmbeddingType: "q8_0",
      outputTensorType: "q6_k",
      allowRequantize: true,
      rules: [
        { pattern: "^blk\\.\\d+\\.attn_q\\.weight$", type: "q8_0" },
      ],
    }))

    expect(validation.valid).toBe(true)
    expect(validation.profile).toMatchObject({
      name: "Profile One",
      baseQuantType: "Q4_K_M",
      tokenEmbeddingType: "Q8_0",
      outputTensorType: "Q6_K",
      allowRequantize: true,
    })
    expect(buildProfileTensorTypeFileContent(validation.profile!)).toBe("^blk\\.\\d+\\.attn_q\\.weight$=Q8_0")
    expect(buildQuantizeArgs("in.gguf", "out.gguf", validation.profile!.baseQuantType, 8, [], "profile.txt", {
      allowRequantize: validation.profile!.allowRequantize,
      tokenEmbeddingType: validation.profile!.tokenEmbeddingType,
      outputTensorType: validation.profile!.outputTensorType,
      imatrixFile: "imatrix.gguf",
    })).toEqual([
      "--allow-requantize",
      "--token-embedding-type",
      "Q8_0",
      "--output-tensor-type",
      "Q6_K",
      "--tensor-type-file",
      "profile.txt",
      "--imatrix",
      "imatrix.gguf",
      "in.gguf",
      "out.gguf",
      "Q4_K_M",
      "8",
    ])
  })

  test("allows precision tensor types in profile tensor overrides only", () => {
    const validation = parseQuantizationProfileJson(JSON.stringify({
      profileVersion: 1,
      name: "BF16 Tensor Profile",
      baseQuantType: "q4_k_m",
      tokenEmbeddingType: "bf16",
      outputTensorType: "f16",
      rules: [
        { pattern: "^blk\\.0\\.attn_q\\.weight$", type: "bf16" },
        { pattern: "^blk\\.1\\.attn_k\\.weight$", type: "F32" },
      ],
    }))

    expect(validation.valid).toBe(true)
    expect(validation.profile).toMatchObject({
      baseQuantType: "Q4_K_M",
      tokenEmbeddingType: "BF16",
      outputTensorType: "F16",
      rules: [
        { pattern: "^blk\\.0\\.attn_q\\.weight$", type: "BF16" },
        { pattern: "^blk\\.1\\.attn_k\\.weight$", type: "F32" },
      ],
    })
    expect(buildProfileTensorTypeFileContent(validation.profile!)).toBe(
      "^blk\\.0\\.attn_q\\.weight$=BF16\n^blk\\.1\\.attn_k\\.weight$=F32",
    )
    expect(profileHasUnknownQuantTypes(validation.profile!)).toBe(false)

    expect(parseQuantizationProfileJson(JSON.stringify({
      profileVersion: 1,
      name: "Advanced Base Precision",
      baseQuantType: "BF16",
      rules: [],
    })).valid).toBe(true)
  })

  test("rejects invalid quantization profiles", () => {
    expect(parseQuantizationProfileJson("{").valid).toBe(false)
    expect(parseQuantizationProfileJson(JSON.stringify({
      profileVersion: 1,
      name: "Bad Type",
      baseQuantType: "NOPE",
      rules: [],
    })).valid).toBe(false)
    expect(parseQuantizationProfileJson(JSON.stringify({
      profileVersion: 1,
      name: "Bad Regex",
      baseQuantType: "Q4_K_M",
      rules: [{ pattern: "[", type: "Q8_0" }],
    })).valid).toBe(false)
  })
})

describe("quantize screen render", () => {
  test("shows layer count, output filename, and preview confirmation", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 100, height: 48 })
    renderer.root.add(createQuantizeScreen(renderer))
    await renderOnce()

    let frame = captureCharFrame()
    expect(frame).toContain("Layers: 7 (0-6)")
    expect(frame).toContain("Advanced layer quantization")
    expect(frame).toContain("Importance matrix")
    expect(frame).toContain("None")
    expect(frame).toContain("Output filename:")
    expect(frame).toContain("tiny-Q6_K.gguf")
    expect(frame).not.toContain("Selectasource")

    mockInput.pressEnter()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).toContain("Layer")
    expect(frame).toContain("none")
    expect(frame).toContain("Enter")
    expect(frame).toContain("confirm")

    renderer.destroy()
  })

  test("shows selected imatrix in preview", async () => {
    const imatrixPath = path.join(tempDir, "output_models", "imatrix.gguf")
    writeFakeGguf(imatrixPath, 7)
    fs.writeFileSync(path.join(tempDir, "quant-em-config.json"), JSON.stringify({
      lastImatrixFile: imatrixPath,
    }))

    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 120, height: 60 })
    renderer.root.add(createQuantizeScreen(renderer))
    await renderOnce()

    let frame = captureCharFrame()
    expect(frame).toContain("Importance matrix")
    expect(frame).toContain("imatrix.gguf")

    mockInput.pressEnter()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).toContain("Imatrix:")
    expect(frame).toContain("imatrix.gguf")

    renderer.destroy()
  })

  test("shows an explicit none option for JSON profiles", async () => {
    fs.mkdirSync(path.join(tempDir, "quant_profiles"), { recursive: true })
    fs.writeFileSync(path.join(tempDir, "quant_profiles", "profile-one.json"), JSON.stringify({
      profileVersion: 1,
      name: "Profile One",
      baseQuantType: "Q4_K_M",
      rules: [],
    }))

    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 110, height: 36 })
    renderer.root.add(createQuantizeScreen(renderer))
    await renderOnce()

    const frame = captureCharFrame()
    expect(frame).toContain("JSON quantization profile:")
    expect(frame).toContain("None")
    expect(frame).toContain("Profile One")

    renderer.destroy()
  })
})

describe("convert screen render", () => {
  test("shows safetensors model directories", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 110, height: 32 })
    renderer.root.add(createConvertScreen(renderer))
    await renderOnce()

    const frame = captureCharFrame()
    expect(frame).toContain("gemma-4-31B-it-qat-q4_0-unquantized-heretic")
    expect(frame).toContain("llama-test-model")
    expect(frame).toContain("Output precision:")
    expect(frame).toContain("General-purpose intermediate")
    expect(frame).toContain("source safetensors are BF16")

    renderer.destroy()
  })
})
