export interface QuantEmConfig {
  llamaCppPath: string | null
  llamaCppVersion: string | null
  backend: "cpu" | "cuda-12" | "cuda-13" | "vulkan" | null
  sourceModelsDir: string
  outputModelsDir: string
  defaultThreads: number
  hfToken: string | null
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
  tier: "recommended" | "smallest" | "balanced" | "higher"
  description: string
}

export const QUANT_TYPES: QuantType[] = [
  { name: "Q4_K_M", tier: "recommended", description: "Best balance of size and quality" },
  { name: "Q5_K_M", tier: "recommended", description: "Good balance, slightly larger" },
  { name: "Q6_K", tier: "recommended", description: "Very good quality, larger still" },
  { name: "IQ1_S", tier: "smallest", description: "Extremely small, low quality" },
  { name: "IQ2_XXS", tier: "smallest", description: "Very small" },
  { name: "IQ2_XS", tier: "smallest", description: "Very small" },
  { name: "IQ2_S", tier: "smallest", description: "Very small" },
  { name: "IQ2_M", tier: "smallest", description: "Small" },
  { name: "IQ3_XXS", tier: "smallest", description: "Small" },
  { name: "IQ3_XS", tier: "balanced", description: "Balanced small" },
  { name: "IQ3_S", tier: "balanced", description: "Balanced small" },
  { name: "IQ3_M", tier: "balanced", description: "Balanced" },
  { name: "IQ4_XS", tier: "balanced", description: "Balanced" },
  { name: "IQ4_NL", tier: "balanced", description: "Balanced" },
  { name: "Q3_K_S", tier: "balanced", description: "Balanced, small" },
  { name: "Q3_K_M", tier: "balanced", description: "Balanced" },
  { name: "Q3_K_L", tier: "balanced", description: "Balanced, larger" },
  { name: "Q4_K_S", tier: "higher", description: "Good quality" },
  { name: "Q5_K_S", tier: "higher", description: "High quality" },
  { name: "Q8_0", tier: "higher", description: "Highest quality (near FP16)" },
]

export const DEFAULT_CONFIG: QuantEmConfig = {
  llamaCppPath: null,
  llamaCppVersion: null,
  backend: null,
  sourceModelsDir: "source_models",
  outputModelsDir: "output_models",
  defaultThreads: 8,
  hfToken: null,
}
