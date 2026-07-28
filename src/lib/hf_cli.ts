import * as path from "path"
import { resolvePath } from "./config"
import { fileExists } from "./file_utils"
import { checkCommandExists, runProcess, type ProcessOutputCallback } from "./process_runner"
import { ensureProjectVenv } from "./project_venv"

export function getProjectHfCommand(): string | null {
  const relativePath = process.platform === "win32"
    ? path.join(".venv", "Scripts", "hf.exe")
    : path.join(".venv", "bin", "hf")
  const hfPath = resolvePath(relativePath)
  return fileExists(hfPath) ? hfPath : null
}

export function getHfCommand(): string {
  return getProjectHfCommand() || "hf"
}

export async function checkHfCommandExists(): Promise<boolean> {
  const projectHf = getProjectHfCommand()
  if (projectHf) return true
  return checkCommandExists("hf")
}

export async function installProjectHfCli(
  onOutput?: ProcessOutputCallback,
): Promise<{ ok: boolean; hfPath: string | null; error?: string }> {
  const venv = await ensureProjectVenv(onOutput)
  if (!venv.ok) {
    return { ok: false, hfPath: null, error: venv.error }
  }

  onOutput?.('Installing huggingface_hub[cli]...', "stdout")
  const { result: pipResult } = runProcess({
    cmd: venv.pythonPath,
    args: ["-m", "pip", "install", "-U", "huggingface_hub[cli]"],
    onOutput,
  })
  const pipData = await pipResult
  if (pipData.exitCode !== 0) {
    return { ok: false, hfPath: null, error: pipData.stderr || "pip install failed" }
  }

  const hfPath = getProjectHfCommand()
  if (!hfPath) {
    return { ok: false, hfPath: null, error: "Install finished but hf was not found in .venv" }
  }
  return { ok: true, hfPath }
}
