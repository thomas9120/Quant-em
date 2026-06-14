export interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface GitHubRelease {
  tag_name: string
  assets: ReleaseAsset[]
}

export function findAssetForBackend(
  release: GitHubRelease,
  backend: string,
  platform = process.platform,
  arch = process.arch,
): ReleaseAsset | null {
  const platformPatterns: Record<string, string[]> = {
    "win32-x64": ["-bin-win-"],
    "linux-x64": ["-bin-ubuntu-"],
    "darwin-arm64": ["-bin-macos-arm64"],
  }

  const backendPatterns: Record<string, string[]> = {
    cpu: ["-cpu-", "-ubuntu-x64.", "-macos-arm64."],
    "cuda-12": ["-cuda-12."],
    "cuda-13": ["-cuda-13."],
    vulkan: ["-vulkan-"],
  }

  const platformKey = `${platform}-${arch}`
  const platPats = platformPatterns[platformKey] || []
  const backPats = backendPatterns[backend] || []

  for (const asset of release.assets) {
    const name = asset.name.toLowerCase()
    const isLlamaBinary = name.startsWith("llama-") && name.includes("-bin-")
    const matchesPlatform = platPats.some((p) => name.includes(p))
    const matchesBackend = backPats.some((p) => name.includes(p))
    const matchesArchive = platform === "win32" ? name.endsWith(".zip") : name.endsWith(".tar.gz")
    if (isLlamaBinary && matchesPlatform && matchesBackend && matchesArchive) {
      return asset
    }
  }

  return null
}
