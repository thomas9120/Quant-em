import * as fs from "fs"
import * as path from "path"
import { resolvePath } from "./config"

export interface ConvertTool {
  scriptPath: string
  scriptDir: string
  ggufPyPath: string | null
}

export function findConvertScript(llamaCppSourcePath: string | null, llamaCppPath: string | null): ConvertTool | null {
  const scriptName = "convert_hf_to_gguf.py"
  const candidates: string[] = []

  if (llamaCppSourcePath) {
    candidates.push(path.join(resolvePath(llamaCppSourcePath), scriptName))
  }

  if (llamaCppPath) {
    let dir = resolvePath(llamaCppPath)
    for (let i = 0; i < 5; i++) {
      candidates.push(path.join(dir, scriptName))
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  candidates.push(resolvePath(path.join("llama_cpp", scriptName)))
  candidates.push(resolvePath(scriptName))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const scriptDir = path.dirname(candidate)
      const ggufPyPath = path.join(scriptDir, "gguf-py")
      return {
        scriptPath: candidate,
        scriptDir,
        ggufPyPath: fs.existsSync(path.join(ggufPyPath, "gguf")) ? ggufPyPath : null,
      }
    }
  }

  return null
}

export function buildPythonPath(tool: ConvertTool): string | undefined {
  const entries = [
    tool.ggufPyPath,
    process.env.PYTHONPATH,
  ].filter((entry): entry is string => Boolean(entry))

  return entries.length > 0 ? entries.join(path.delimiter) : undefined
}

export function getRequirementsPath(scriptDir: string): string {
  const convertRequirements = path.join(scriptDir, "requirements", "requirements-convert_hf_to_gguf.txt")
  if (fs.existsSync(convertRequirements)) return convertRequirements
  return path.join(scriptDir, "requirements.txt")
}
