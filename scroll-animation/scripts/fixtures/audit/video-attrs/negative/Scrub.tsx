export function Scrub() {
  return <video src="/clip.mp4" muted playsInline preload="auto" autoPlay loop />
}

/**
 * Prose that mentions a tag by name must not trigger this rule:
 * <video src="/clip.mp4" autoPlay loop /> selects its source once, so a
 * commented-out example like this one is not a real element.
 */
