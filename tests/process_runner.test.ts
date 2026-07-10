import { describe, expect, test } from "bun:test"
import { runProcess } from "../src/lib/process_runner"
import * as path from "path"

describe("runProcess", () => {
  test("captures stdout, stderr, callbacks, and final unterminated lines", async () => {
    const outputEvents: string[] = []
    const stdoutLines: string[] = []
    const stderrLines: string[] = []

    const { result } = runProcess({
      cmd: process.execPath,
      args: [
        "-e",
        "process.stdout.write('first\\nlast'); process.stderr.write('warn\\r\\nfinal-err')",
      ],
      onOutput: (line, stream) => outputEvents.push(`${stream}:${line}`),
      onStdout: (line) => stdoutLines.push(line),
      onStderr: (line) => stderrLines.push(line),
    })
    const data = await result

    expect(data).toEqual({
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

    const { result } = runProcess({
      cmd: missingCommand,
      args: [],
      onStderr: (line) => stderrLines.push(line),
    })
    const data = await result

    expect(data.exitCode).toBe(-1)
    expect(data.stdout).toBe("")
    expect(data.stderr.length).toBeGreaterThan(0)
    expect(stderrLines).toEqual([data.stderr])
  })

  test("abort kills a long-running process and the result still settles", async () => {
    const { result, abort } = runProcess({
      cmd: process.execPath,
      args: ["-e", "setTimeout(() => {}, 30000)"],
    })

    setTimeout(abort, 100)
    const data = await result

    expect(data.exitCode).not.toBe(0)
  }, 10000)
})
