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

const DEFAULT_PROCESS_ENV: Record<string, string> = {
  PYTHONIOENCODING: "utf-8",
  PYTHONUTF8: "1",
}

export function runProcess(opts: RunProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const stdoutLines: string[] = []
    const stderrLines: string[] = []

    let proc: ReturnType<typeof Bun.spawn>
    try {
      proc = Bun.spawn([opts.cmd, ...opts.args], {
        cwd: opts.cwd,
        env: { ...process.env, ...DEFAULT_PROCESS_ENV, ...opts.env },
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch (err: any) {
      const message = err?.message || String(err)
      stderrLines.push(message)
      opts.onOutput?.(message, "stderr")
      opts.onStderr?.(message, "stderr")
      resolve({
        exitCode: -1,
        stdout: "",
        stderr: message,
      })
      return
    }

    const reader = (
      stream: ReadableStream<Uint8Array>,
      label: "stdout" | "stderr",
      lines: string[],
    ): Promise<void> => {
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

      return (async () => {
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
        } catch (err: any) {
          const message = err?.message || String(err)
          lines.push(message)
          opts.onOutput?.(message, label)
          if (label === "stdout") opts.onStdout?.(message, label)
          if (label === "stderr") opts.onStderr?.(message, label)
        }
      })()
    }

    const stdoutDone = reader(proc.stdout as ReadableStream<Uint8Array>, "stdout", stdoutLines)
    const stderrDone = reader(proc.stderr as ReadableStream<Uint8Array>, "stderr", stderrLines)

    proc.exited.then(async (code) => {
      await Promise.all([stdoutDone, stderrDone])
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
