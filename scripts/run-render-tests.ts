const renderTests = [
  {
    file: "tests/quantize_screen.test.ts",
    pattern: "shows layer count, output filename, and preview confirmation",
  },
  {
    file: "tests/quantize_screen.test.ts",
    pattern: "warns when keep-split is selected for a non-split input",
  },
  {
    file: "tests/quantize_screen.test.ts",
    pattern: "updates generated output filename when quant type changes",
  },
  {
    file: "tests/quantize_screen.test.ts",
    pattern: "shows selected imatrix in preview",
  },
  {
    file: "tests/quantize_screen.test.ts",
    pattern: "shows an explicit none option for JSON profiles",
  },
  {
    file: "tests/quantize_screen.test.ts",
    pattern: "shows default quant hint when JSON profile overrides it",
  },
  {
    file: "tests/quantize_screen.test.ts",
    pattern: "shows safetensors model directories",
  },
]

for (const test of renderTests) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", test.file, "-t", test.pattern],
    env: {
      ...process.env,
      QUANT_EM_RENDER_TESTS: "1",
    },
    stdout: "inherit",
    stderr: "inherit",
  })

  if (result.exitCode !== 0) {
    process.exit(result.exitCode)
  }
}
