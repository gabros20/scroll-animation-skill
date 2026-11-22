// A film the visitor starts with its sound: controls, no autoplay. It must not need `muted`.
export function Film() {
  return <video src="/film.mp4" poster="/film.jpg" controls playsInline preload="none" />
}
