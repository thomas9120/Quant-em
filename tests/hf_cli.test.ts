import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { checkCommandExists } from "../src/lib/process_runner"
import { getHfCommand, getProjectHfCommand, installProjectHfCli } from "../src/lib/hf_cli"

const originalRoot = process.env.QUANT_EM_PROJECT_ROOT

afterEach(() => {
  if (originalRoot === undefined) {
    delete process.env.QUANT_EM_PROJECT_ROOT
  } else {
    process.env.QUANT_EM_PROJECT_ROOT = originalRoot
  }
})

describe("hf_cli", () => {
  test("falls back to bare hf when project venv is missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quant-em-hf-"))
    process.env.QUANT_EM_PROJECT_ROOT = tempDir

    expect(getProjectHfCommand()).toBeNull()
    expect(getHfCommand()).toBe("hf")
  })

  test("installProjectHfCli creates venv hf when python is available", async () => {
    if (!(await checkCommandExists("python"))) return

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quant-em-hf-install-"))
    process.env.QUANT_EM_PROJECT_ROOT = tempDir

    const result = await installProjectHfCli()

    expect(result.ok).toBe(true)
    expect(result.hfPath).toBeTruthy()
    expect(getProjectHfCommand()).toBe(result.hfPath)
    expect(fs.existsSync(result.hfPath!)).toBe(true)
  }, 120_000)
})
