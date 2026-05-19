# Quant-em - Progress Log

## Project Overview
A TUI program for quantizing models using llama.cpp's quantization tools.
Built with OpenTUI (`@opentui/core`) on Bun runtime.

## Design Notes
- ASCII art logo in **cyan** color (`#00FFFF`)
- Modular architecture: each tool/feature is a separate screen + lib module
- Future features (layer pruning, imatrix generation, etc.) should slot in as new screens + lib modules
- All subprocess operations go through `process_runner.ts` for consistency

---

## Phase 1: Core Infrastructure

- [x] 1.1 Initialize Bun project (`bun init`, add `@opentui/core`)
- [x] 1.2 Basic renderer setup with main menu screen
- [x] 1.3 `src/lib/config.ts` - load/save JSON config
- [x] 1.4 `src/lib/file_utils.ts` - scan dirs, detect file types (.gguf, .safetensors)
- [x] 1.5 `src/lib/process_runner.ts` - spawn subprocess, stream stdout/stderr, update UI
- [x] 1.6 Reusable UI: header component (with cyan ASCII logo)
- [x] 1.7 Reusable UI: status bar component
- [x] 1.8 Reusable UI: file picker component
- [x] 1.9 Reusable UI: process output panel component
- [x] 1.10 Screen navigation system (push/pop stack, Escape to go back)

## Phase 2: Quantize Workflow (Primary Feature)

- [x] 2.1 `src/lib/quantizer.ts` - wrap `llama-quantize` via Bun.spawn (integrated in quantize_screen.ts)
- [x] 2.2 Quantize screen - file picker for source GGUF files
- [x] 2.3 Quantize screen - quantization type selector (grouped by tier)
- [ ] 2.4 Quantize screen - advanced options panel (imatrix, threads, flags)
- [x] 2.5 Quantize screen - output filename generation
- [x] 2.6 Real-time output streaming in process panel
- [x] 2.7 Error handling and validation

## Phase 3: Auto-Installer

- [x] 3.1 `src/lib/installer.ts` - GitHub releases API, detect platform (integrated in setup_screen.ts)
- [x] 3.2 Setup screen - backend selection (CPU, CUDA, Vulkan)
- [x] 3.3 Download and extract llama.cpp release to `./llama_cpp/`
- [ ] 3.4 Fetch `convert_hf_to_gguf.py` from repo source
- [ ] 3.5 Version checking and update notifications

## Phase 4: Download Workflow

- [x] 4.1 `src/lib/downloader.ts` - wrap `hf download` CLI (integrated in download_screen.ts)
- [x] 4.2 Download screen - repo ID input, include patterns
- [x] 4.3 Progress display from HF CLI output
- [ ] 4.4 Post-download: auto-detect if downloaded file is GGUF or safetensors

## Phase 5: Convert Workflow

- [x] 5.1 `src/lib/converter.ts` - wrap `convert_hf_to_gguf.py` (integrated in convert_screen.ts)
- [x] 5.2 Python detection and dependency check
- [x] 5.3 Convert screen - folder picker, precision options
- [x] 5.4 Real-time output streaming

## Phase 6: Polish & Extras

- [x] 6.1 Keyboard shortcuts (Ctrl+C cancel, Escape back)
- [x] 6.2 Settings screen (paths, threads, HF token)
- [x] 6.3 Config persistence across sessions
- [ ] 6.4 Cross-platform testing (Windows primary)
- [ ] 6.5 Layer pruning screen (future - `--prune-layers` support)
- [ ] 6.6 Imatrix generation screen (future - `llama-imatrix` support)

---

## Changelog

### Session 1 - 2026-05-18
- Researched OpenTUI API, components, and bindings
- Researched llama.cpp quantization types, CLI tools, and release structure
- Researched HuggingFace `hf` CLI for downloading models
- Established tech stack: Bun + @opentui/core (imperative API)
- Decided: auto-install llama.cpp from GitHub releases with backend selection
- Decided: shell out to `hf download` CLI for HuggingFace downloads
- Decided: support both GGUF quantization (primary) and safetensors conversion (secondary)
- Created development plan and progress log

### Session 2 - 2026-05-18
- Initialized Bun project, installed `@opentui/core@0.2.14`
- Created full directory structure: `src/lib/`, `src/ui/`, `src/ui/components/`
- Built core infrastructure:
  - `src/types.ts` - shared types, QUANT_TYPES constant, DEFAULT_CONFIG
  - `src/lib/config.ts` - load/save JSON config, path resolution
  - `src/lib/file_utils.ts` - scan dirs, detect GGUF/safetensors, format file sizes
  - `src/lib/process_runner.ts` - runProcess with stdout/stderr streaming
- Built reusable UI components:
  - `src/ui/components/header.ts` - cyan ASCII art logo
  - `src/ui/components/status_bar.ts` - bottom bar with dep status
  - `src/ui/components/file_picker.ts` - GGUF file selector
  - `src/ui/components/process_panel.ts` - scrollable output panel
- Built screen navigation system (`src/ui/navigator.ts` - push/pop/replace)
- Built all 6 screens:
  - `src/ui/main_menu.ts` - main menu with Select component
  - `src/ui/quantize_screen.ts` - file picker + quant type selector + process panel
  - `src/ui/download_screen.ts` - HF download with repo ID + include pattern
  - `src/ui/convert_screen.ts` - safetensors dir picker + precision selector
  - `src/ui/setup_screen.ts` - llama.cpp auto-installer from GitHub releases
  - `src/ui/settings_screen.ts` - paths, threads, HF token config
- App boots successfully: logo renders in cyan, menu is navigable, status bar shows dep detection
