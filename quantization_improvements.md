# Quantization-Focused Improvement Ideas

These ideas keep Quant-em focused on quantization while making long-running quantize jobs easier to choose, verify, and recover from.

## Highest Priority

1. **Quantization preview before start** - implemented
   - Show a summary before running: input file, output file, quant type, thread count, layer count, and prune list.
   - Goal: catch wrong selections before a long quantization job starts.

2. **Overwrite warning** - implemented
   - If the target output GGUF already exists, require confirmation before starting.
   - Goal: prevent accidental replacement of a previously generated model.

3. **Live prune validation** - implemented
   - Validate the prune input while typing.
   - Show feedback such as `3 layers selected` or `Invalid: 99 outside 0-31`.
   - Goal: make pruning safer now that the app can read GGUF layer counts.

## Strong Follow-Ups

4. **Output filename control** - implemented
   - Let the user edit or confirm the output filename instead of only auto-generating `${baseName}-${quantType}.gguf`.
   - Goal: make repeated runs and custom naming clearer.

5. **Quant type grouping** - implemented
   - Make quant types easier to scan by grouping or labeling them by intent: recommended, balanced, smallest, and high quality.
   - Goal: reduce the feeling of choosing from a wall of similar options.

6. **Better failure hints** - implemented
   - Detect common failures from `llama-quantize`, such as missing binary, unsupported quant type, bad path, permission error, or output directory issues.
   - Goal: turn failed runs into actionable next steps.

## Nice-To-Have

7. **Estimated output size hints** - implemented
   - Show rough expected size percentages or estimates for common quant types.
   - Goal: help users choose a quantization level based on storage and quality tradeoffs.

8. **Remember last choices** - implemented
   - Save the last quant type, thread count, and possibly the last selected model.
   - Goal: make repeated quantization runs faster.

9. **Quantization history** - implemented
   - Keep a simple recent-run list with input, output, quant type, timestamp, and success/failure.
   - Goal: make it easier to see what has already been produced.

10. **Small-window layout mode** - implemented
    - Detect cramped terminal height and reduce descriptions, list heights, or secondary text.
    - Goal: avoid text overlap and keep the quantize screen usable in smaller windows.
