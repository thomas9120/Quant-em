import { QUANT_TYPES, type LayerQuantRule } from "../types"

export interface LayerQuantValidation {
  rules: LayerQuantRule[]
  valid: boolean
  message: string
}

export function normalizeQuantType(value: string): string | null {
  const normalized = value.trim().toUpperCase()
  const match = QUANT_TYPES.find((qt) => qt.name.toUpperCase() === normalized)
  return match?.name || null
}

export function parseLayerQuantRules(value: string, layerCount: number | null): LayerQuantValidation {
  const trimmed = value.trim()
  if (!trimmed) {
    return { rules: [], valid: true, message: "No layer quantization overrides" }
  }

  const parts = trimmed.split(";").map((part) => part.trim()).filter(Boolean)
  const rules: LayerQuantRule[] = []

  for (const part of parts) {
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?\s*=\s*([A-Za-z0-9_]+)$/)
    if (!match) {
      return {
        rules,
        valid: false,
        message: `Invalid rule: ${part}. Use e.g. 0-3=Q8_0`,
      }
    }

    const startToken = match[1] || ""
    const endToken = match[2]
    const quantToken = match[3] || ""
    const startLayer = Number(startToken)
    const endLayer = endToken === undefined ? startLayer : Number(endToken)
    const quantType = normalizeQuantType(quantToken)

    if (!quantType) {
      return {
        rules,
        valid: false,
        message: `Unknown quant type: ${quantToken}`,
      }
    }

    if (endLayer < startLayer) {
      return {
        rules,
        valid: false,
        message: `Invalid range: ${startLayer}-${endLayer}`,
      }
    }

    if (layerCount !== null && (startLayer < 0 || endLayer >= layerCount)) {
      return {
        rules,
        valid: false,
        message: `Invalid layer range: ${startLayer}-${endLayer}. Valid range: 0-${layerCount - 1}`,
      }
    }

    rules.push({ startLayer, endLayer, quantType })
  }

  for (let i = 1; i < rules.length; i++) {
    const previous = rules[i - 1]
    const current = rules[i]
    if (previous && current && current.startLayer < previous.startLayer) {
      return {
        rules,
        valid: false,
        message: "Layer quantization rules must be ordered by layer",
      }
    }
  }

  const covered = new Set<number>()
  for (const rule of rules) {
    for (let layer = rule.startLayer; layer <= rule.endLayer; layer++) {
      if (covered.has(layer)) {
        return {
          rules,
          valid: false,
          message: `Layer ${layer} is covered by more than one rule`,
        }
      }
      covered.add(layer)
    }
  }

  return {
    rules,
    valid: true,
    message: `${rules.length} layer quantization override${rules.length === 1 ? "" : "s"}`,
  }
}

export function buildTensorTypeFileContent(rules: LayerQuantRule[]): string {
  return rules
    .map((rule) => {
      const pattern = rule.startLayer === rule.endLayer
        ? `blk\\.${rule.startLayer}\\..*`
        : `blk\\.(${rangeToAlternation(rule.startLayer, rule.endLayer)})\\..*`
      return `${pattern}=${rule.quantType}`
    })
    .join("\n")
}

export function buildQuantizeArgs(
  inputFile: string,
  outputFile: string,
  defaultQuantType: string,
  threads: number,
  pruneLayers: string[],
  tensorTypeFile: string | null,
): string[] {
  const args: string[] = []
  if (pruneLayers.length > 0) {
    args.push("--prune-layers", pruneLayers.join(","))
  }
  if (tensorTypeFile) {
    args.push("--tensor-type-file", tensorTypeFile)
  }
  args.push(inputFile, outputFile, defaultQuantType, String(threads))
  return args
}

export function formatLayerQuantSummary(rules: LayerQuantRule[]): string {
  if (rules.length === 0) return "none"
  return rules
    .map((rule) => `${formatLayerRange(rule)}=${rule.quantType}`)
    .join("; ")
}

export function formatMixedQuantLabel(defaultQuantType: string, rules: LayerQuantRule[]): string {
  if (rules.length === 0) return defaultQuantType
  const types = Array.from(new Set(rules.map((rule) => rule.quantType)))
  return `mixed: ${types.join("/")}; base ${defaultQuantType}`
}

function formatLayerRange(rule: LayerQuantRule): string {
  return rule.startLayer === rule.endLayer
    ? String(rule.startLayer)
    : `${rule.startLayer}-${rule.endLayer}`
}

function rangeToAlternation(start: number, end: number): string {
  const layers: string[] = []
  for (let layer = start; layer <= end; layer++) {
    layers.push(String(layer))
  }
  return layers.join("|")
}
