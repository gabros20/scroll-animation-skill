// words.html's whole bundle: it records when it ran, so tests/text.mjs can tell whether the words waited for it.
declare global {
  interface Window {
    __bundleRanAt?: number
  }
}

window.__bundleRanAt = performance.now()

export {}
