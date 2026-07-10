import type { QuantEmConfig, QuantizationProfile, TensorQuantRule } from "../types"
import { QUANT_TYPES } from "../types"
import { ensureDir, resolvePath } from "./config"
import { runProcess } from "./process_runner"
import { EXTRA_PROFILE_TENSOR_TYPES } from "./quantization_profiles"
import * as fs from "fs"
import * as path from "path"

export interface GgufTensorInfo {
  name: string
  type: string
}

export interface GgufDumpInfo {
  filename: string
  metadata: Record<string, { value?: unknown }>
  tensors: Record<string, { type?: unknown }>
}

export interface ExtractedProfileResult {
  profile: QuantizationProfile
  tensorCount: number
  typeCounts: Record<string, number>
  generatedRuleCount: number
  skippedTypes: Record<string, number>
  warnings: string[]
}

const FTYPE_TO_QUANT_TYPE: Record<number, string> = {
  0: "F32",
  1: "F16",
  2: "Q4_0",
  3: "Q4_1",
  7: "Q8_0",
  8: "Q5_0",
  9: "Q5_1",
  10: "Q2_K",
  11: "Q3_K_S",
  12: "Q3_K_M",
  13: "Q3_K_L",
  14: "Q4_K_S",
  15: "Q4_K_M",
  17: "Q5_K_M",
  18: "Q6_K",
  19: "IQ2_XXS",
  20: "IQ2_XS",
  21: "Q2_K_S",
  22: "IQ3_XS",
  23: "IQ3_XXS",
  24: "IQ1_S",
  25: "IQ4_NL",
  26: "IQ3_S",
  27: "IQ3_M",
  28: "IQ2_S",
  29: "IQ2_M",
  30: "IQ4_XS",
  31: "IQ1_M",
  32: "BF16",
  36: "TQ1_0",
  37: "TQ2_0",
  38: "MXFP4_MOE",
  39: "NVFP4",
  40: "Q1_0",
}

const VALID_BASE_TYPES = new Set(QUANT_TYPES.map((type) => type.name))
const VALID_TENSOR_TYPES = new Set([
  ...QUANT_TYPES.map((type) => type.name).filter((name) => name !== "COPY"),
  "F32",
  "F16",
  "BF16",
  ...EXTRA_PROFILE_TENSOR_TYPES,
])

function normalizeType(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toUpperCase()
  if (VALID_TENSOR_TYPES.has(normalized)) return normalized
  return null
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
}

function sanitizeFileStem(value: string): string {
  return value
    .replace(/\.gguf$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "gguf-profile"
}

function getMetadataValue(dump: GgufDumpInfo, key: string): unknown {
  return dump.metadata?.[key]?.value
}

function inferBaseQuantType(dump: GgufDumpInfo, tensors: GgufTensorInfo[]): string | null {
  const fileType = getMetadataValue(dump, "general.file_type")
  if (typeof fileType === "number" && FTYPE_TO_QUANT_TYPE[fileType] && VALID_BASE_TYPES.has(FTYPE_TO_QUANT_TYPE[fileType])) {
    return FTYPE_TO_QUANT_TYPE[fileType]
  }

  const counts = new Map<string, number>()
  for (const tensor of tensors) {
    if (!VALID_BASE_TYPES.has(tensor.type) || tensor.type === "COPY") continue
    counts.set(tensor.type, (counts.get(tensor.type) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
}

function getTypeCounts(tensors: GgufTensorInfo[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const tensor of tensors) {
    counts[tensor.type] = (counts[tensor.type] || 0) + 1
  }
  return counts
}

function addSkipped(skippedTypes: Record<string, number>, type: string) {
  skippedTypes[type] = (skippedTypes[type] || 0) + 1
}

function compactLayerPattern(names: string[]): string {
  const parsed = names
    .map((name) => {
      const match = name.match(/^blk\.(\d+)\.(.+)$/)
      return match ? { layer: Number(match[1]), suffix: match[2] || "" } : null
    })
    .filter((value): value is { layer: number; suffix: string } => Boolean(value))

  if (parsed.length === names.length && new Set(parsed.map((item) => item.suffix)).size === 1) {
    const layers = parsed.map((item) => item.layer).sort((a, b) => a - b)
    const suffix = escapeRegex(parsed[0]?.suffix || "")
    const consecutive = layers.every((layer, index) => index === 0 || layer === layers[index - 1]! + 1)
    if (layers.length > 3 && consecutive) {
      return `^blk\\.(${layers[0]}|${layers.slice(1, -1).join("|")}|${layers[layers.length - 1]})\\.${suffix}$`
    }
    return `^blk\\.(${layers.join("|")})\\.${suffix}$`
  }

  return `^(${names.map(escapeRegex).join("|")})$`
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function buildCompactRules(tensors: GgufTensorInfo[], baseQuantType: string): {
  tokenEmbeddingType?: string
  outputTensorType?: string
  rules: TensorQuantRule[]
  skippedTypes: Record<string, number>
} {
  const skippedTypes: Record<string, number> = {}
  const groups = new Map<string, string[]>()
  let tokenEmbeddingType: string | undefined
  let outputTensorType: string | undefined

  for (const tensor of tensors) {
    if (!VALID_TENSOR_TYPES.has(tensor.type)) {
      addSkipped(skippedTypes, tensor.type)
      continue
    }
    if (tensor.type === baseQuantType) continue

    if (tensor.name === "token_embd.weight") {
      tokenEmbeddingType = tensor.type
      continue
    }
    if (tensor.name === "output.weight") {
      outputTensorType = tensor.type
      continue
    }

    const layerMatch = tensor.name.match(/^blk\.\d+\.(.+)$/)
    const groupKey = layerMatch ? `${tensor.type}\tblk.*.${layerMatch[1]}` : `${tensor.type}\t${tensor.name}`
    const group = groups.get(groupKey) || []
    group.push(tensor.name)
    groups.set(groupKey, group)
  }

  const rules = [...groups.entries()]
    .map(([key, names]) => {
      const type = key.split("\t", 1)[0] || ""
      return {
        pattern: compactLayerPattern(names),
        type,
      }
    })
    .sort((a, b) => compareStrings(a.pattern, b.pattern) || compareStrings(a.type, b.type))

  return { tokenEmbeddingType, outputTensorType, rules, skippedTypes }
}

export function parseGgufDumpJson(raw: string): GgufDumpInfo {
  const parsed = JSON.parse(raw) as GgufDumpInfo
  if (!parsed || typeof parsed !== "object" || !parsed.metadata || !parsed.tensors) {
    throw new Error("GGUF dump did not contain metadata and tensors")
  }
  return parsed
}

export function extractProfileFromDump(dump: GgufDumpInfo, fallbackFileName: string): ExtractedProfileResult {
  const tensors = Object.entries(dump.tensors || {}).map(([name, info]) => ({
    name,
    type: normalizeType(info.type) || String(info.type || "UNKNOWN").toUpperCase(),
  }))
  const baseQuantType = inferBaseQuantType(dump, tensors)
  if (!baseQuantType) {
    throw new Error("Could not infer a supported base quantization type from this GGUF")
  }

  const fileName = path.basename(dump.filename || fallbackFileName)
  const { tokenEmbeddingType, outputTensorType, rules, skippedTypes } = buildCompactRules(tensors, baseQuantType)
  const warnings: string[] = []
  const skippedTotal = Object.values(skippedTypes).reduce((sum, count) => sum + count, 0)
  if (skippedTotal > 0) {
    warnings.push(`Skipped ${skippedTotal} tensor(s) with unsupported type(s): ${Object.keys(skippedTypes).join(", ")}`)
  }
  warnings.push("Extracted profiles preserve tensor storage types only; imatrix/calibration data is not recoverable from a GGUF.")

  const profile: QuantizationProfile = {
    profileVersion: 1,
    name: `${sanitizeFileStem(fileName)} extracted`,
    description: `Extracted from ${fileName}. Intended for the same base model/tensor layout.`,
    source: {
      kind: "reference-gguf",
      fileName,
    },
    baseQuantType,
    allowRequantize: false,
    rules,
  }
  if (tokenEmbeddingType) profile.tokenEmbeddingType = tokenEmbeddingType
  if (outputTensorType) profile.outputTensorType = outputTensorType

  return {
    profile,
    tensorCount: tensors.length,
    typeCounts: getTypeCounts(tensors),
    generatedRuleCount: rules.length,
    skippedTypes,
    warnings,
  }
}

export function findGgufDumpScript(config: QuantEmConfig): string | null {
  const version = config.llamaCppVersion
  const sourceDirName = version ? `llama.cpp-${version}` : null

  const candidates: (string | null)[] = [
    config.llamaCppSourcePath ? path.join(resolvePath(config.llamaCppSourcePath), "gguf-py", "gguf", "scripts", "gguf_dump.py") : null,
    config.llamaCppPath && sourceDirName ? path.join(resolvePath(config.llamaCppPath), "source", sourceDirName, "gguf-py", "gguf", "scripts", "gguf_dump.py") : null,
    config.llamaCppPath && sourceDirName ? path.join(path.dirname(resolvePath(config.llamaCppPath)), "source", sourceDirName, "gguf-py", "gguf", "scripts", "gguf_dump.py") : null,
    version && sourceDirName ? path.join(resolvePath("llama_cpp"), version, "source", sourceDirName, "gguf-py", "gguf", "scripts", "gguf_dump.py") : null,
  ]

  const found = candidates.find((candidate) => candidate !== null && fs.existsSync(candidate))
  if (found) return found

  return findGgufDumpScriptByScan(config)
}

function findGgufDumpScriptByScan(config: QuantEmConfig): string | null {
  const searchRoots: string[] = []
  if (config.llamaCppPath) {
    searchRoots.push(path.join(resolvePath(config.llamaCppPath), "source"))
    searchRoots.push(path.join(path.dirname(resolvePath(config.llamaCppPath)), "source"))
  }
  searchRoots.push(resolvePath("llama_cpp"))

  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue
    const found = scanForGgufDumpScript(root)
    if (found) return found
  }
  return null
}

function scanForGgufDumpScript(root: string): string | null {
  const targetSegments = ["gguf-py", "gguf", "scripts", "gguf_dump.py"]
  function walk(currentDir: string, depth: number): string | null {
    if (depth > 8) return null
    const candidate = path.join(currentDir, ...targetSegments)
    if (fs.existsSync(candidate)) return candidate
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = walk(path.join(currentDir, entry.name), depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return walk(root, 0)
}

export async function analyzeGgufFile(filePath: string, config: QuantEmConfig): Promise<ExtractedProfileResult> {
  const script = findGgufDumpScript(config)
  if (!script) {
    throw new Error("Could not find llama.cpp gguf_dump.py. Run Setup or configure the llama.cpp source path.")
  }

  const { result } = runProcess({
    cmd: "python",
    args: [script, "--json", resolvePath(filePath)],
  })
  const resultData = await result
  if (resultData.exitCode !== 0) {
    throw new Error(resultData.stderr || "gguf_dump.py failed")
  }

  return extractProfileFromDump(parseGgufDumpJson(resultData.stdout), filePath)
}

export function buildProfileFileName(profile: QuantizationProfile): string {
  return `${sanitizeFileStem(profile.name)}.json`
}

export function saveExtractedProfile(profile: QuantizationProfile, quantProfilesDir: string): string {
  ensureDir(quantProfilesDir)
  const fullDir = resolvePath(quantProfilesDir)
  let fileName = buildProfileFileName(profile)
  let fullPath = path.join(fullDir, fileName)
  let counter = 2
  while (fs.existsSync(fullPath)) {
    fileName = `${sanitizeFileStem(profile.name)}-${counter++}.json`
    fullPath = path.join(fullDir, fileName)
  }
  fs.writeFileSync(fullPath, JSON.stringify(profile, null, 2), "utf-8")
  return fullPath
}
