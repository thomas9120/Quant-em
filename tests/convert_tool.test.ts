import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { buildPythonPath, findConvertScript, getRequirementsPath } from "../src/lib/convert_tool"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

let tempDir = ""
let originalProjectRoot: string | undefined
let originalPythonPath: string | undefined

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quant-em-convert-test-"))
  originalProjectRoot = process.env.QUANT_EM_PROJECT_ROOT
  originalPythonPath = process.env.PYTHONPATH
  process.env.QUANT_EM_PROJECT_ROOT = tempDir
  delete process.env.PYTHONPATH
})

afterEach(() => {
  if (originalProjectRoot === undefined) delete process.env.QUANT_EM_PROJECT_ROOT
  else process.env.QUANT_EM_PROJECT_ROOT = originalProjectRoot

  if (originalPythonPath === undefined) delete process.env.PYTHONPATH
  else process.env.PYTHONPATH = originalPythonPath

  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe("convert tool helpers", () => {
  test("finds configured llama.cpp source with gguf-py modules", () => {
    const sourceDir = path.join(tempDir, "llama-source")
    fs.mkdirSync(path.join(sourceDir, "gguf-py", "gguf"), { recursive: true })
    fs.writeFileSync(path.join(sourceDir, "convert_hf_to_gguf.py"), "")

    const tool = findConvertScript("llama-source", null)

    expect(tool).toEqual({
      scriptPath: path.join(sourceDir, "convert_hf_to_gguf.py"),
      scriptDir: sourceDir,
      ggufPyPath: path.join(sourceDir, "gguf-py"),
    })
  })

  test("walks up from llama.cpp binary path to find converter script", () => {
    const checkoutDir = path.join(tempDir, "llama.cpp")
    const binaryDir = path.join(checkoutDir, "build", "bin")
    fs.mkdirSync(binaryDir, { recursive: true })
    fs.writeFileSync(path.join(checkoutDir, "convert_hf_to_gguf.py"), "")

    const tool = findConvertScript(null, binaryDir)

    expect(tool?.scriptPath).toBe(path.join(checkoutDir, "convert_hf_to_gguf.py"))
    expect(tool?.ggufPyPath).toBeNull()
  })

  test("builds PYTHONPATH with gguf-py before existing entries", () => {
    process.env.PYTHONPATH = path.join(tempDir, "existing-pythonpath")
    const ggufPyPath = path.join(tempDir, "llama-source", "gguf-py")

    expect(buildPythonPath({
      scriptPath: path.join(tempDir, "llama-source", "convert_hf_to_gguf.py"),
      scriptDir: path.join(tempDir, "llama-source"),
      ggufPyPath,
    })).toBe(`${ggufPyPath}${path.delimiter}${process.env.PYTHONPATH}`)
  })

  test("prefers converter-specific requirements when present", () => {
    const scriptDir = path.join(tempDir, "llama-source")
    const requirementsDir = path.join(scriptDir, "requirements")
    fs.mkdirSync(requirementsDir, { recursive: true })
    const convertRequirements = path.join(requirementsDir, "requirements-convert_hf_to_gguf.txt")
    fs.writeFileSync(convertRequirements, "")

    expect(getRequirementsPath(scriptDir)).toBe(convertRequirements)
  })
})
