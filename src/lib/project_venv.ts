import * as path from "path"
import { resolvePath } from "./config"
import { fileExists } from "./file_utils"
import { checkCommandExists, runProcess, type ProcessOutputCallback } from "./process_runner"

export function getProjectVenvPython(): string | null {
  const relativePath = process.platform === "win32"
    ? path.join(".venv", "Scripts", "python.exe")
    : path.join(".venv", "bin", "python")
  const pythonPath = resolvePath(relativePath)
  return fileExists(pythonPath) ? pythonPath : null
}

export async function ensureProjectVenv(
  onOutput?: ProcessOutputCallback,
): Promise<{ ok: true; pythonPath: string } | { ok: false; error: string }> {
  const existing = getProjectVenvPython()
  if (existing) {
    onOutput?.("Using existing project .venv", "stdout")
    return { ok: true, pythonPath: existing }
  }

  const hasPython = await checkCommandExists("python")
  if (!hasPython) {
    return { ok: false, error: "Python not found. Install Python first." }
  }

  const venvDir = resolvePath(".venv")
  onOutput?.("Creating project .venv...", "stdout")
  const { result } = runProcess({
    cmd: "python",
    args: ["-m", "venv", venvDir],
    onOutput,
  })
  const data = await result
  if (data.exitCode !== 0) {
    return { ok: false, error: data.stderr || "Failed to create .venv" }
  }

  const pythonPath = getProjectVenvPython()
  if (!pythonPath) {
    return { ok: false, error: "Created .venv but python was not found inside it" }
  }
  return { ok: true, pythonPath }
}
