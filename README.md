# Quant-em

Quant-em is a terminal UI for downloading Hugging Face models, converting safetensors models to GGUF, and quantizing GGUF models with llama.cpp.

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

By default, source files are read from `source_models/` and generated models are written to `output_models/`.
