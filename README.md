# Quant-em

Quant-em is a terminal UI for downloading Hugging Face models, converting safetensors models to GGUF, and quantizing GGUF models with llama.cpp. This is a work-in-progress.

## Requirements

- Windows, macOS, or Linux
- [Bun](https://bun.sh/) installed
- Python, if you want to convert safetensors models to GGUF
- llama.cpp tools, installed through the app's Setup screen or configured in Settings

## Start

On Windows, double-click:

```bat
start-quant-em.bat
```

Or run manually:

```bash
bun install
bun run start
```

## Basic Use

Use arrow keys to move, Enter to select/start, Tab to switch fields, and Esc to go back.

- Setup: install or manage llama.cpp binaries.
- Settings: configure llama.cpp path, source model directory, output directory, threads, and Hugging Face token.
- Download Model: download a Hugging Face repo into `source_models/`.
- Convert to GGUF: convert a safetensors model directory into a GGUF file.
- Quantize Model: choose a GGUF file, select a quantization type, optionally enter comma-separated layer numbers to prune, then start quantization.

### Per-layer quantization

On the Quantize Model screen, the selected quantization type is the default for the whole model. To override specific transformer layers, enter semicolon-separated rules in the advanced layer quantization field:

```text
0-3=Q8_0; 4-20=Q5_K_M; 21-31=Q4_K_M
```

Each rule uses `layer` or `start-end=QUANT_TYPE`. Layers are zero-based, must not overlap, and must be within the layer range shown at the top of the screen.

### JSON quantization profiles

Quant-em can also load reusable JSON profiles from `quant_profiles/`. Profiles describe a base quantization type plus optional per-tensor regex overrides that are passed to `llama-quantize` with `--tensor-type-file`.

Example:

```json
{
  "profileVersion": 1,
  "name": "Example Mixed Tensor Profile",
  "baseQuantType": "Q4_K_M",
  "tokenEmbeddingType": "Q8_0",
  "outputTensorType": "Q6_K",
  "allowRequantize": false,
  "rules": [
    {
      "pattern": "^blk\\.\\d+\\.attn_q\\.weight$",
      "type": "Q8_0"
    }
  ]
}
```

Put profile files in `quant_profiles/`, then choose `JSON profile` on the Quantize Model screen. The profile's `baseQuantType` becomes the final quant type, while `tokenEmbeddingType`, `outputTensorType`, and `rules` become llama.cpp tensor overrides.

By default, source files are read from `source_models/` and generated models are written to `output_models/`.

## Screenshot

![Quant-em TUI screenshot](screenshots/Screenshot%202026-05-19%20182045.png)
