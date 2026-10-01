// Every entry boots its engine through here. `?boot=<ms>` holds it back, so a check can see the page before
// JavaScript (the gate on, no engine ready yet) or let the failsafe fire first; `?boot=never` keeps it off.
// `__fx.bootedAt` is the page time the engine started, `hide()`/`show()` stand in for a route hidden and shown again
// (Next's Activity on the Motion page; teardown and display: none on the others).

export interface FixtureApi {
  hide(): void
  show(): void
}

export function boot(start: () => void, api: FixtureApi): void {
  const fx = { ...api, bootedAt: null as number | null }
  Object.assign(window, { __fx: fx })
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
