import { QUANT_TYPES, type QuantizationProfile, type TensorQuantRule } from "../types"
import { resolvePath } from "./config"
import * as fs from "fs"
import * as path from "path"

export interface ProfileValidation {
  profile: QuantizationProfile | null
  valid: boolean
  message: string
}

export interface ProfileFile {
  name: string
  path: string
  profile: QuantizationProfile
}

const VALID_QUANT_TYPES = new Set(QUANT_TYPES.map((qt) => qt.name))

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeProfileQuantType(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toUpperCase()
  return QUANT_TYPES.find((qt) => qt.name.toUpperCase() === normalized)?.name || null
}

function validateRule(value: unknown, index: number): TensorQuantRule | string {
  if (!isObject(value)) return `Rule ${index + 1} must be an object`
  if (typeof value.pattern !== "string" || !value.pattern.trim()) {
    return `Rule ${index + 1} needs a pattern`
  }
  try {
    new RegExp(value.pattern)
  } catch {
    return `Rule ${index + 1} has an invalid regex pattern`
  }

  const type = normalizeProfileQuantType(value.type)
  if (!type) return `Rule ${index + 1} has an unknown quant type`

  return {
    pattern: value.pattern,
    type,
  }
}

export function parseQuantizationProfileJson(raw: string): ProfileValidation {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err: any) {
    return { profile: null, valid: false, message: `Invalid JSON: ${err?.message || err}` }
  }

  if (!isObject(parsed)) return { profile: null, valid: false, message: "Profile must be a JSON object" }
  if (parsed.profileVersion !== 1) {
    return { profile: null, valid: false, message: "Unsupported profileVersion; expected 1" }
  }
  if (typeof parsed.name !== "string" || !parsed.name.trim()) {
    return { profile: null, valid: false, message: "Profile needs a name" }
  }

  const baseQuantType = normalizeProfileQuantType(parsed.baseQuantType)
  if (!baseQuantType) return { profile: null, valid: false, message: "Profile has an unknown baseQuantType" }

  const tokenEmbeddingType = parsed.tokenEmbeddingType === undefined
    ? undefined
    : normalizeProfileQuantType(parsed.tokenEmbeddingType)
  if (parsed.tokenEmbeddingType !== undefined && !tokenEmbeddingType) {
    return { profile: null, valid: false, message: "Profile has an unknown tokenEmbeddingType" }
  }

  const outputTensorType = parsed.outputTensorType === undefined
    ? undefined
    : normalizeProfileQuantType(parsed.outputTensorType)
  if (parsed.outputTensorType !== undefined && !outputTensorType) {
    return { profile: null, valid: false, message: "Profile has an unknown outputTensorType" }
  }

  if (!Array.isArray(parsed.rules)) return { profile: null, valid: false, message: "Profile needs a rules array" }

  const rules: TensorQuantRule[] = []
  for (let i = 0; i < parsed.rules.length; i++) {
    const rule = validateRule(parsed.rules[i], i)
    if (typeof rule === "string") return { profile: null, valid: false, message: rule }
    rules.push(rule)
  }

  const profile: QuantizationProfile = {
    profileVersion: 1,
    name: parsed.name.trim(),
    baseQuantType,
    rules,
  }

  if (typeof parsed.description === "string" && parsed.description.trim()) {
    profile.description = parsed.description.trim()
  }
  if (isObject(parsed.source)) {
    const kind = parsed.source.kind
    if (kind === "reference-gguf" || kind === "manual" || kind === "imported") {
      profile.source = { kind }
      if (typeof parsed.source.fileName === "string" && parsed.source.fileName.trim()) {
        profile.source.fileName = parsed.source.fileName.trim()
      }
    }
  }
  if (tokenEmbeddingType) profile.tokenEmbeddingType = tokenEmbeddingType
  if (outputTensorType) profile.outputTensorType = outputTensorType
  if (typeof parsed.allowRequantize === "boolean") profile.allowRequantize = parsed.allowRequantize

  return { profile, valid: true, message: `${rules.length} tensor override${rules.length === 1 ? "" : "s"}` }
}

export function loadQuantizationProfile(filePath: string): ProfileValidation {
  try {
    return parseQuantizationProfileJson(fs.readFileSync(resolvePath(filePath), "utf-8"))
  } catch (err: any) {
    return { profile: null, valid: false, message: `Could not read profile: ${err?.message || err}` }
  }
}

export function scanForQuantizationProfiles(dir: string): ProfileFile[] {
  const fullDir = resolvePath(dir)
  if (!fs.existsSync(fullDir)) return []

  const profiles: ProfileFile[] = []
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue
    const fullPath = path.join(fullDir, entry.name)
    const validation = loadQuantizationProfile(fullPath)
    if (validation.profile) {
      profiles.push({
        name: validation.profile.name,
        path: path.relative(fullDir, fullPath),
        profile: validation.profile,
      })
    }
  }

  return profiles.sort((a, b) => a.name.localeCompare(b.name))
}

export function buildProfileTensorTypeFileContent(profile: QuantizationProfile): string {
  return profile.rules.map((rule) => `${rule.pattern}=${rule.type}`).join("\n")
}

export function formatProfileSummary(profile: QuantizationProfile): string {
  const pieces = [`${profile.name}`, `base ${profile.baseQuantType}`, `${profile.rules.length} rules`]
  if (profile.tokenEmbeddingType) pieces.push(`embd ${profile.tokenEmbeddingType}`)
  if (profile.outputTensorType) pieces.push(`out ${profile.outputTensorType}`)
  return pieces.join(" | ")
}

export function profileHasUnknownQuantTypes(profile: QuantizationProfile): boolean {
  const types = [
    profile.baseQuantType,
    profile.tokenEmbeddingType,
    profile.outputTensorType,
    ...profile.rules.map((rule) => rule.type),
  ].filter((value): value is string => Boolean(value))
  return types.some((type) => !VALID_QUANT_TYPES.has(type))
}
