import { describe, expect, test } from "bun:test"
import { findAssetForBackend, type GitHubRelease } from "../src/lib/setup_release"

function asset(name: string) {
  return {
    name,
    browser_download_url: `https://example.test/${name}`,
    size: 1024,
  }
}

describe("setup release asset selection", () => {
  test("selects Windows CUDA 12 zip without matching decoys", () => {
    const release: GitHubRelease = {
      tag_name: "b9999",
      assets: [
        asset("llama-b9999-bin-win-cpu-x64.zip"),
        asset("llama-b9999-bin-win-cuda-12.4-x64.tar.gz"),
        asset("other-b9999-bin-win-cuda-12.4-x64.zip"),
        asset("llama-b9999-bin-win-cuda-12.4-x64.zip"),
      ],
    }

    expect(findAssetForBackend(release, "cuda-12", "win32", "x64")?.name).toBe(
      "llama-b9999-bin-win-cuda-12.4-x64.zip",
    )
  })

  test("selects Linux CPU tarball using ubuntu platform naming", () => {
    const release: GitHubRelease = {
      tag_name: "b9999",
      assets: [
        asset("llama-b9999-bin-win-cpu-x64.zip"),
        asset("llama-b9999-bin-ubuntu-x64.tar.gz"),
      ],
    }

    expect(findAssetForBackend(release, "cpu", "linux", "x64")?.name).toBe(
      "llama-b9999-bin-ubuntu-x64.tar.gz",
    )
  })

  test("selects macOS ARM64 CPU tarball and rejects unsupported platform/backend combinations", () => {
    const release: GitHubRelease = {
      tag_name: "b9999",
      assets: [
        asset("llama-b9999-bin-macos-arm64.tar.gz"),
        asset("llama-b9999-bin-macos-arm64.zip"),
      ],
    }

    expect(findAssetForBackend(release, "cpu", "darwin", "arm64")?.name).toBe(
      "llama-b9999-bin-macos-arm64.tar.gz",
    )
    expect(findAssetForBackend(release, "cuda-13", "darwin", "arm64")).toBeNull()
    expect(findAssetForBackend(release, "cpu", "darwin", "x64")).toBeNull()
  })
})
