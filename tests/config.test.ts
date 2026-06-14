import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { DEFAULT_CONFIG } from "../src/types"
import { getConfigPath, loadConfig, resolvePath, saveConfig } from "../src/lib/config"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

let tempDir = ""
let originalProjectRoot: string | undefined
let originalHfToken: string | undefined
let originalHuggingFaceHubToken: string | undefined
let originalHfHome: string | undefined
let originalHfTokenPath: string | undefined
let originalHome: string | undefined
let originalUserProfile: string | undefined

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quant-em-config-test-"))
  originalProjectRoot = process.env.QUANT_EM_PROJECT_ROOT
  originalHfToken = process.env.HF_TOKEN
  originalHuggingFaceHubToken = process.env.HUGGING_FACE_HUB_TOKEN
  originalHfHome = process.env.HF_HOME
  originalHfTokenPath = process.env.HF_TOKEN_PATH
  originalHome = process.env.HOME
  originalUserProfile = process.env.USERPROFILE

  process.env.QUANT_EM_PROJECT_ROOT = tempDir
  delete process.env.HF_TOKEN
  delete process.env.HUGGING_FACE_HUB_TOKEN
  delete process.env.HF_HOME
  delete process.env.HF_TOKEN_PATH
  process.env.HOME = path.join(tempDir, "home")
  process.env.USERPROFILE = path.join(tempDir, "userprofile")
})

afterEach(() => {
  if (originalProjectRoot === undefined) delete process.env.QUANT_EM_PROJECT_ROOT
  else process.env.QUANT_EM_PROJECT_ROOT = originalProjectRoot

  if (originalHfToken === undefined) delete process.env.HF_TOKEN
  else process.env.HF_TOKEN = originalHfToken

  if (originalHuggingFaceHubToken === undefined) delete process.env.HUGGING_FACE_HUB_TOKEN
  else process.env.HUGGING_FACE_HUB_TOKEN = originalHuggingFaceHubToken

  if (originalHfHome === undefined) delete process.env.HF_HOME
  else process.env.HF_HOME = originalHfHome

  if (originalHfTokenPath === undefined) delete process.env.HF_TOKEN_PATH
  else process.env.HF_TOKEN_PATH = originalHfTokenPath

  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome

  if (originalUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = originalUserProfile

  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe("config", () => {
  test("loads partial config from project root while preserving defaults", () => {
    fs.writeFileSync(getConfigPath(), JSON.stringify({
      outputModelsDir: "custom-output",
      defaultThreads: 12,
    }))

    const config = loadConfig()

    expect(config).toMatchObject({
      ...DEFAULT_CONFIG,
      outputModelsDir: "custom-output",
      defaultThreads: 12,
    })
    expect(resolvePath(config.outputModelsDir)).toBe(path.join(tempDir, "custom-output"))
  })

  test("fills missing HF token from environment without overriding config token", () => {
    process.env.HF_TOKEN = " env-token "
    expect(loadConfig().hfToken).toBe("env-token")

    saveConfig({
      ...DEFAULT_CONFIG,
      hfToken: "config-token",
    })

    expect(loadConfig().hfToken).toBe("config-token")
  })

  test("fills missing HF token from token file", () => {
    const tokenFile = path.join(tempDir, "hf-token")
    fs.writeFileSync(tokenFile, " file-token \n")
    process.env.HF_TOKEN_PATH = tokenFile

    expect(loadConfig().hfToken).toBe("file-token")
  })
})
