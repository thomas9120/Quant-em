import * as path from "path"
import { resolvePath } from "./config"
import { fileExists } from "./file_utils"
import { checkCommandExists } from "./process_runner"

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
