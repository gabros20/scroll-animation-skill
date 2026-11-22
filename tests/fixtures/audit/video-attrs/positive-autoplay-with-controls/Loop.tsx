// Autoplay needs `muted`, with or without controls.
export function Loop() {
  return <video src="/loop.mp4" autoPlay controls playsInline preload="metadata" />
}
