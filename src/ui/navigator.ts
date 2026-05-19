import type { BoxRenderable } from "@opentui/core"
import type { CliRenderer } from "@opentui/core"

type ScreenFactory = (renderer: CliRenderer) => BoxRenderable

interface ScreenEntry {
  factory: ScreenFactory
}

const screenStack: ScreenEntry[] = []
let currentScreen: BoxRenderable | null = null
let currentCleanup: (() => void) | null = null
let currentScreenFactory: ScreenFactory | null = null
let renderer: CliRenderer | null = null

export function initNavigator(r: CliRenderer, initialFactory: ScreenFactory) {
  renderer = r
  pushScreen(initialFactory)
}

export function pushScreen(factory: ScreenFactory) {
  if (!renderer) return

  if (currentScreen) {
    if (currentCleanup) {
      currentCleanup()
      currentCleanup = null
    }
    screenStack.push({
      factory: currentScreenFactory!,
    })
    renderer.root.remove(currentScreen.id)
  }

  currentScreenFactory = factory
  currentCleanup = null
  currentScreen = factory(renderer)
  renderer.root.add(currentScreen)
  renderer.requestRender()
}

export function popScreen() {
  if (!renderer || screenStack.length === 0) return

  if (currentCleanup) {
    currentCleanup()
    currentCleanup = null
  }

  if (currentScreen) {
    renderer.root.remove(currentScreen.id)
  }

  const prev = screenStack.pop()!
  currentScreenFactory = prev.factory
  currentCleanup = null
  currentScreen = prev.factory(renderer)
  renderer.root.add(currentScreen)
  renderer.requestRender()
}

export function replaceScreen(factory: ScreenFactory) {
  if (!renderer) return

  if (currentCleanup) {
    currentCleanup()
    currentCleanup = null
  }

  if (currentScreen) {
    renderer.root.remove(currentScreen.id)
  }

  currentScreenFactory = factory
  currentCleanup = null
  currentScreen = factory(renderer)
  renderer.root.add(currentScreen)
  renderer.requestRender()
}

export function setCleanup(fn: () => void) {
  currentCleanup = fn
}

export function getCurrentScreen(): BoxRenderable | null {
  return currentScreen
}

export function getStackDepth(): number {
  return screenStack.length
}
