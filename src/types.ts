export interface QuantEmConfig {
  llamaCppPath: string | null
  llamaCppSourcePath: string | null
  llamaCppVersion: string | null
  backend: "cpu" | "cuda-12" | "cuda-13" | "vulkan" | null
  sourceModelsDir: string
  outputModelsDir: string
  quantProfilesDir: string
  defaultThreads: number
  hfToken: string | null
  lastQuantType: string | null
  lastQuantSource: string | null
  lastQuantProfile: string | null
  lastImatrixFile: string | null
  quantizationHistory: QuantizationHistoryEntry[]
}

export interface ProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface ModelFile {
  name: string
  path: string
  size: number
  type: "gguf" | "safetensors" | "unknown"
}

export interface QuantType {
  name: string
  tier: "recommended" | "smallest" | "balanced" | "higher" | "advanced"
  description: string
  estimatedSizeRatio: number
}

export interface LayerQuantRule {
  startLayer: number
  endLayer: number
  quantType: string
}

export interface TensorQuantRule {
  pattern: string
  type: string
}

export interface QuantizationProfile {
  profileVersion: 1
  name: string
  description?: string
  source?: {
    kind: "reference-gguf" | "manual" | "imported"
    fileName?: string
  }
  baseQuantType: string
  tokenEmbeddingType?: string
  outputTensorType?: string
  allowRequantize?: boolean
  rules: TensorQuantRule[]
}

export interface QuantizationHistoryEntry {
  input: string
  output: string
  quantType: string
  imatrixFile?: string | null
  prunedLayers: string[]
  timestamp: string
  success: boolean
  exitCode: number | null
}

export const QUANT_TYPES: QuantType[] = [
  { name: "Q4_K_M", tier: "recommended", description: "Best balance of size and quality", estimatedSizeRatio: 0.31 },
  { name: "Q5_K_M", tier: "recommended", description: "Good balance, slightly larger", estimatedSizeRatio: 0.38 },
  { name: "Q6_K", tier: "recommended", description: "Very good quality, larger still", estimatedSizeRatio: 0.46 },
  { name: "Q1_0", tier: "smallest", description: "Tiny 1-bit quantization, very low quality", estimatedSizeRatio: 0.07 },
  { name: "IQ1_S", tier: "smallest", description: "Extremely small, low quality", estimatedSizeRatio: 0.11 },
  { name: "IQ1_M", tier: "smallest", description: "Very small 1-bit quantization", estimatedSizeRatio: 0.12 },
  { name: "TQ1_0", tier: "smallest", description: "Tiny ternary quantization", estimatedSizeRatio: 0.11 },
  { name: "IQ2_XXS", tier: "smallest", description: "Very small", estimatedSizeRatio: 0.16 },
  { name: "IQ2_XS", tier: "smallest", description: "Very small", estimatedSizeRatio: 0.18 },
  { name: "IQ2_S", tier: "smallest", description: "Very small", estimatedSizeRatio: 0.2 },
  { name: "Q2_K", tier: "smallest", description: "Small K-quant, lower quality", estimatedSizeRatio: 0.21 },
  { name: "Q2_K_S", tier: "smallest", description: "Small K-quant variant", estimatedSizeRatio: 0.21 },
  { name: "TQ2_0", tier: "smallest", description: "Small ternary quantization", estimatedSizeRatio: 0.13 },
  { name: "IQ2_M", tier: "smallest", description: "Small", estimatedSizeRatio: 0.22 },
  { name: "IQ3_XXS", tier: "smallest", description: "Small", estimatedSizeRatio: 0.24 },
  { name: "IQ3_XS", tier: "balanced", description: "Balanced small", estimatedSizeRatio: 0.26 },
  { name: "IQ3_S", tier: "balanced", description: "Balanced small", estimatedSizeRatio: 0.27 },
  { name: "IQ3_M", tier: "balanced", description: "Balanced", estimatedSizeRatio: 0.29 },
  { name: "IQ4_XS", tier: "balanced", description: "Balanced", estimatedSizeRatio: 0.32 },
  { name: "IQ4_NL", tier: "balanced", description: "Balanced", estimatedSizeRatio: 0.33 },
  { name: "Q3_K_S", tier: "balanced", description: "Balanced, small", estimatedSizeRatio: 0.28 },
  { name: "Q3_K_M", tier: "balanced", description: "Balanced", estimatedSizeRatio: 0.3 },
  { name: "Q3_K_L", tier: "balanced", description: "Balanced, larger", estimatedSizeRatio: 0.32 },
  { name: "Q4_0", tier: "balanced", description: "Legacy 4-bit quantization", estimatedSizeRatio: 0.31 },
  { name: "Q4_1", tier: "balanced", description: "Legacy 4-bit quantization, slightly larger", estimatedSizeRatio: 0.34 },
  { name: "Q4_K_S", tier: "higher", description: "Good quality", estimatedSizeRatio: 0.29 },
  { name: "MXFP4_MOE", tier: "higher", description: "MXFP4 quantization for MoE models", estimatedSizeRatio: 0.31 },
  { name: "NVFP4", tier: "higher", description: "NVFP4 quantization for supported models", estimatedSizeRatio: 0.31 },
  { name: "Q5_0", tier: "higher", description: "Legacy 5-bit quantization", estimatedSizeRatio: 0.37 },
  { name: "Q5_1", tier: "higher", description: "Legacy 5-bit quantization, slightly larger", estimatedSizeRatio: 0.4 },
  { name: "Q5_K_S", tier: "higher", description: "High quality", estimatedSizeRatio: 0.36 },
  { name: "Q8_0", tier: "higher", description: "Highest quality (near FP16)", estimatedSizeRatio: 0.55 },
  { name: "F16", tier: "advanced", description: "Mostly F16 output; large, near-original precision", estimatedSizeRatio: 1 },
  { name: "BF16", tier: "advanced", description: "Mostly BF16 output; large, near-original precision", estimatedSizeRatio: 1 },
  { name: "F32", tier: "advanced", description: "All F32 output; very large", estimatedSizeRatio: 2 },
  { name: "COPY", tier: "advanced", description: "Copy tensors without quantizing", estimatedSizeRatio: 1 },
]

export const DEFAULT_CONFIG: QuantEmConfig = {
  llamaCppPath: null,
  llamaCppSourcePath: null,
  llamaCppVersion: null,
  backend: null,
  sourceModelsDir: "source_models",
  outputModelsDir: "output_models",
  quantProfilesDir: "quant_profiles",
  defaultThreads: 8,
  hfToken: null,
  lastQuantType: null,
  lastQuantSource: null,
  lastQuantProfile: null,
  lastImatrixFile: null,
  quantizationHistory: [],
}
