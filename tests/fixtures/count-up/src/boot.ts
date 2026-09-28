// Every entry boots its engine through here. `?boot=<ms>` holds it back, so a check can let the failsafe fire first;
// `?boot=never` keeps it off. `hide()`/`show()` stand in for a route hidden and shown again (Next's Activity on the
// Motion page; stop, display: none and a new mount on the agnostic one).

export interface FixtureApi {
  hide(): void
  show(): void
}

declare global {
  interface Window {
    __fx: FixtureApi & { bootedAt: number | null }
  }
}

export function boot(start: () => void, api: FixtureApi): void {
  const fx = { ...api, bootedAt: null as number | null }
  window.__fx = fx
  const param = new URLSearchParams(location.search).get('boot')
  if (param === 'never') return
  const run = () => {
    fx.bootedAt = performance.now()
    start()
  }
  const delay = Number(param)
  if (delay > 0) setTimeout(run, delay)
  else run()
}
