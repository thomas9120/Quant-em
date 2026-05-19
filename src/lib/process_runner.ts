import type { Subprocess } from "bun"
import type { ProcessResult } from "../types"

export type ProcessOutputCallback = (line: string, stream: "stdout" | "stderr") => void

export interface RunProcessOptions {
  cmd: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  onOutput?: ProcessOutputCallback
  onStdout?: ProcessOutputCallback
  onStderr?: ProcessOutputCallback
}

export function runProcess(opts: RunProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const stdoutLines: string[] = []
    const stderrLines: string[] = []

    const proc = Bun.spawn([opts.cmd, ...opts.args], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdout: "pipe",
      stderr: "pipe",
    })

    const reader = (
      stream: ReadableStream<Uint8Array>,
      label: "stdout" | "stderr",
      lines: string[],
    ) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      function processChunk(chunk: string) {
        buffer += chunk
        const parts = buffer.split("\n")
        buffer = parts.pop() || ""
        for (const part of parts) {
          const line = part.replace(/\r$/, "")
          lines.push(line)
          opts.onOutput?.(line, label)
          if (label === "stdout") opts.onStdout?.(line, label)
          if (label === "stderr") opts.onStderr?.(line, label)
        }
      }

      ;(async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              if (buffer.length > 0) {
                const line = buffer.replace(/\r$/, "")
                lines.push(line)
                opts.onOutput?.(line, label)
                if (label === "stdout") opts.onStdout?.(line, label)
                if (label === "stderr") opts.onStderr?.(line, label)
              }
              break
            }
            processChunk(decoder.decode(value, { stream: true }))
          }
        } catch {
        }
      })()
    }

    reader(proc.stdout as ReadableStream<Uint8Array>, "stdout", stdoutLines)
    reader(proc.stderr as ReadableStream<Uint8Array>, "stderr", stderrLines)

    proc.exited.then((code) => {
      resolve({
        exitCode: code,
        stdout: stdoutLines.join("\n"),
        stderr: stderrLines.join("\n"),
      })
    })
  })
}

export async function checkCommandExists(cmd: string): Promise<boolean> {
  try {
    const result = await runProcess({
      cmd: process.platform === "win32" ? "where" : "which",
      args: [cmd],
    })
    return result.exitCode === 0
  } catch {
    return false
  }
}
