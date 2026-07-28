const pureTestFiles = [
  "tests/config.test.ts",
  "tests/process_runner.test.ts",
  "tests/file_utils.test.ts",
  "tests/convert_tool.test.ts",
  "tests/setup_release.test.ts",
  "tests/hf_cli.test.ts",
]

function run(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, ...args],
    stdout: "inherit",
    stderr: "inherit",
  })

  if (result.exitCode !== 0) {
    process.exit(result.exitCode)
  }
}

run(["test", ...pureTestFiles])
run(["test", "tests/quantize_screen.test.ts", "-t", "quantize screen helpers"])
