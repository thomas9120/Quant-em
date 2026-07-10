import type { ProcessResult } from "../types"

export type ProcessOutputCallback = (line: string, stream: "stdout" | "stderr") => void
export type StreamCallback = (line: string) => void

export interface RunProcessOptions {
  cmd: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  onOutput?: ProcessOutputCallback
  onStdout?: StreamCallback
  onStderr?: StreamCallback
}

export interface RunProcessHandle {
  result: Promise<ProcessResult>
  abort: () => void
}

const DEFAULT_PROCESS_ENV: Record<string, string> = {
  PYTHONIOENCODING: "utf-8",
  PYTHONUTF8: "1",
}

export function runProcess(opts: RunProcessOptions): RunProcessHandle {
  let proc: ReturnType<typeof Bun.spawn> | null = null

  const result = new Promise<ProcessResult>((resolve) => {
    const stdoutLines: string[] = []
    const stderrLines: string[] = []

    try {
      proc = Bun.spawn([opts.cmd, ...opts.args], {
        cwd: opts.cwd,
        env: { ...process.env, ...DEFAULT_PROCESS_ENV, ...opts.env },
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      stderrLines.push(message)
      opts.onOutput?.(message, "stderr")
      opts.onStderr?.(message)
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
          if (label === "stdout") opts.onStdout?.(line)
          if (label === "stderr") opts.onStderr?.(line)
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
                if (label === "stdout") opts.onStdout?.(line)
                if (label === "stderr") opts.onStderr?.(line)
              }
              break
            }
            processChunk(decoder.decode(value, { stream: true }))
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          lines.push(message)
          opts.onOutput?.(message, label)
          if (label === "stdout") opts.onStdout?.(message)
          if (label === "stderr") opts.onStderr?.(message)
        }
      })()
    }

    if (proc.stdout && proc.stderr) {
      const stdoutDone = reader(proc.stdout as ReadableStream<Uint8Array>, "stdout", stdoutLines)
      const stderrDone = reader(proc.stderr as ReadableStream<Uint8Array>, "stderr", stderrLines)

      Promise.all([stdoutDone, stderrDone, proc.exited]).then(([_, __, code]) => {
        resolve({
          exitCode: code,
          stdout: stdoutLines.join("\n"),
          stderr: stderrLines.join("\n"),
        })
      })
    } else {
      resolve({
        exitCode: -1,
        stdout: "",
        stderr: "Process has no stdout/stderr streams",
      })
    }
  })

  const abort = () => {
    if (proc) {
      proc.kill()
    }
  }

  return { result, abort }
}

export async function checkCommandExists(cmd: string): Promise<boolean> {
  const { result } = runProcess({
    cmd: process.platform === "win32" ? "where" : "which",
    args: [cmd],
  })
  return (await result).exitCode === 0
}
