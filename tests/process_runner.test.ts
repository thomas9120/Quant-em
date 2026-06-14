import { describe, expect, test } from "bun:test"
import { runProcess } from "../src/lib/process_runner"
import * as path from "path"

describe("runProcess", () => {
  test("captures stdout, stderr, callbacks, and final unterminated lines", async () => {
    const outputEvents: string[] = []
    const stdoutLines: string[] = []
    const stderrLines: string[] = []

    const result = await runProcess({
      cmd: process.execPath,
      args: [
        "-e",
        "process.stdout.write('first\\nlast'); process.stderr.write('warn\\r\\nfinal-err')",
      ],
      onOutput: (line, stream) => outputEvents.push(`${stream}:${line}`),
      onStdout: (line) => stdoutLines.push(line),
      onStderr: (line) => stderrLines.push(line),
    })

    expect(result).toEqual({
      exitCode: 0,
      stdout: "first\nlast",
      stderr: "warn\nfinal-err",
    })
    expect(stdoutLines).toEqual(["first", "last"])
    expect(stderrLines).toEqual(["warn", "final-err"])
    expect(outputEvents).toHaveLength(4)
    expect(outputEvents).toContain("stdout:first")
    expect(outputEvents).toContain("stdout:last")
    expect(outputEvents).toContain("stderr:warn")
    expect(outputEvents).toContain("stderr:final-err")
  })

  test("returns a failed process result when the command cannot start", async () => {
    const missingCommand = path.join(process.cwd(), "definitely-missing-command-for-quant-em-test")
    const stderrLines: string[] = []

    const result = await runProcess({
      cmd: missingCommand,
      args: [],
      onStderr: (line) => stderrLines.push(line),
    })

    expect(result.exitCode).toBe(-1)
    expect(result.stdout).toBe("")
    expect(result.stderr.length).toBeGreaterThan(0)
    expect(stderrLines).toEqual([result.stderr])
  })
})
