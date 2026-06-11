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

## Local Config

Quant-em stores local settings in `quant-em-config.json`. That file is ignored by git because it can contain machine-specific paths and private Hugging Face tokens.

Fresh clones do not need this file. The app uses built-in defaults and writes a local config when settings are saved. See `quant-em-config.example.json` for the safe, token-free shape.

## Basic Use

Use arrow keys to move, Enter to select/start, Tab to switch fields, and Esc to go back.

- Setup: install or manage llama.cpp binaries.
- Settings: configure llama.cpp binary/source paths, source model directory, output directory, threads, and Hugging Face token.
- Download Model: download a Hugging Face repo into `source_models/`.
- Convert to GGUF: convert a safetensors model directory into a GGUF file.
- Quantize Model: choose a GGUF file, select a quantization type, optionally choose an existing imatrix GGUF, optionally keep split GGUF outputs sharded, optionally enter comma-separated layer numbers to prune, then start quantization.

### Conversion setup

The GGUF converter is not a standalone Python file. It needs the llama.cpp source tree, including `gguf-py/`, plus Python packages from llama.cpp's conversion requirements. Quant-em's Setup screen downloads the matching llama.cpp source archive alongside the binary tools and saves it as the llama.cpp source path.

If Python reports a missing package such as `torch`, `numpy`, or `transformers`, install llama.cpp's conversion requirements from that source path:

```bash
python -m pip install -r requirements.txt
```

### Per-layer quantization

On the Quantize Model screen, the selected quantization type is the default for the whole model. To override specific transformer layers, enter semicolon-separated rules in the advanced layer quantization field:

```text
0-3=Q8_0; 4-20=Q5_K_M; 21-31=Q4_K_M
```

Each rule uses `layer` or `start-end=QUANT_TYPE`. Layers are zero-based, must not overlap, and must be within the layer range shown at the top of the screen.

### Importance matrix files

On the Quantize Model screen, the optional importance matrix picker lists `.gguf` files found in `source_models/` and `output_models/`. Choosing one passes it to llama.cpp as:

```bash
llama-quantize --imatrix imatrix.gguf input.gguf output.gguf IQ2_XXS
```

Recent llama.cpp versions write imatrix files in GGUF format by default. Quant-em currently consumes existing imatrix files for quantization; generating new calibration matrices with `llama-imatrix` is a separate workflow.

### Split GGUF inputs

If your source model is already split into GGUF shards such as `model-00001-of-00005.gguf`, select the first shard on the Quantize Model screen. By default, Quant-em asks `llama-quantize` to merge the result into one output GGUF. Set Split output handling to Keep input split shards to pass:

```bash
llama-quantize --keep-split model-00001-of-00005.gguf model-Q4_K_M.gguf Q4_K_M
```

The keep-split option is intended for split GGUF inputs. Hugging Face `.safetensors` shards should stay together in one model directory and go through Convert to GGUF first; they do not need to be manually combined.

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

Put profile files in `quant_profiles/`, then choose `JSON profile` on the Quantize Model screen. The profile's `baseQuantType` becomes the final quant type, while `tokenEmbeddingType`, `outputTensorType`, and `rules` become llama.cpp tensor overrides. Tensor overrides may use the listed quantization types plus precision tensor types `F32`, `F16`, and `BF16`; `COPY` is only valid as a whole-model quantization choice.

### Extracting profiles from GGUF files

Use `Analyze GGUF Profile` from the main menu to inspect an existing GGUF and save a compact JSON profile based on its tensor quantization layout. Extracted profiles are intended for quantizing the same base model or another GGUF with matching tensor names. They preserve observable tensor storage types only; imatrix/calibration data and the original quantization recipe cannot be recovered from a GGUF.

By default, source files are read from `source_models/` and generated models are written to `output_models/`.

## Screenshot

![Quant-em TUI screenshot](screenshots/Screenshot%202026-05-19%20182045.png)
