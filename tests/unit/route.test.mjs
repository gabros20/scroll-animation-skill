// smooth/route.ts's routeChanged(): the page's live authority takes up the router's position first, then the
// page's triggers re-measure, once: the refresh passed in and every registered one (onRouteRefresh), each function
// once. With no authority running there is nothing to sync, and the refresh still runs. Then, for `settle` ms, each
// burst of height changes (a streamed section landing) runs the refreshes again, debounced, without a sync.
// watchRouteSettle() is that watch alone (a fresh load), and one watch runs at a time.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

globalThis.window = globalThis
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
const html = { dataset: {}, classList: { contains: () => false }, scrollHeight: 1000 }
globalThis.document = { documentElement: html, body: {} }

// One observer at a time is enough here: `resize()` reports a change to whatever it observes.
let observer = null
globalThis.ResizeObserver = class {
  constructor(callback) {
    this.callback = callback
    this.targets = []
    observer = this
  }
  observe(target) {
    this.targets.push(target)
  }
  disconnect() {
    this.targets = []
  }
  resize() {
    if (this.targets.length) this.callback([])
  }
}

const { registerHandle, unregisterHandle } = await import('../../skills/scroll-animation/assets/smooth/authority.ts')
const { onRouteRefresh, routeChanged, routeSettled, SETTLE_DEBOUNCE_MS, SETTLE_MS, watchRouteSettle } = await import(
  '../../skills/scroll-animation/assets/smooth/route.ts'
)

function fakeHandle(calls) {
  const handle = { authority: 'lenis', scrollTo() {}, stop() {}, start() {}, destroy() {}, sync: () => calls.push('sync') }
  registerHandle(handle)
  return handle
}

test('the authority syncs before the one refresh', () => {
  const calls = []
  const handle = fakeHandle(calls)
  routeChanged({ refresh: () => calls.push('refresh'), settle: 0 })
  assert.deepEqual(calls, ['sync', 'refresh'])
  unregisterHandle(handle)
})

test('no refresh given: the authority still syncs (a vanilla page whose mount() refreshes)', () => {
  const calls = []
  const handle = fakeHandle(calls)
  routeChanged({ settle: 0 })
  assert.deepEqual(calls, ['sync'])
  unregisterHandle(handle)
})

test('no authority running: the refresh alone', () => {
  const calls = []
  routeChanged({ refresh: () => calls.push('refresh'), settle: 0 })
  assert.deepEqual(calls, ['refresh'])
})

test('registered refreshes run once per change, each function once, until unregistered', () => {
  const calls = []
  const st = () => calls.push('st')
  const other = () => calls.push('other')
  const a = onRouteRefresh(st)
  const b = onRouteRefresh(st) // a second layout registering the same function
  const c = onRouteRefresh(other)
  routeChanged({ refresh: st, settle: 0 }) // passed and registered: still once
  assert.deepEqual(calls.sort(), ['other', 'st'])
  calls.length = 0
  a()
  a() // unregistering twice takes away one registration only
  routeChanged({ settle: 0 })
  assert.deepEqual(calls.sort(), ['other', 'st'])
  calls.length = 0
  b()
  c()
  routeChanged({ settle: 0 })
  assert.deepEqual(calls, [])
})

test('routeSettled() refreshes without syncing the authority', () => {
  const calls = []
  const handle = fakeHandle(calls)
  const off = onRouteRefresh(() => calls.push('registered'))
  routeSettled({ refresh: () => calls.push('refresh') })
  assert.deepEqual(calls, ['registered', 'refresh'])
  off()
  unregisterHandle(handle)
})

test('the settle watch: one refresh per burst of height changes, none without a change, none after the window', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const calls = []
    const handle = fakeHandle(calls)
    const off = onRouteRefresh(() => calls.push('refresh'))
    html.scrollHeight = 1000
    const stop = routeChanged()
    assert.deepEqual(calls, ['sync', 'refresh'])
    assert.deepEqual(observer.targets, [html, document.body])
    calls.length = 0

    // The observer's first report, and any resize that leaves the height as the refresh measured it: nothing.
    observer.resize()
    mock.timers.tick(SETTLE_DEBOUNCE_MS)
    assert.deepEqual(calls, [])

    // A streamed section lands in three reports, a frame apart: one refresh, no sync.
    html.scrollHeight = 2400
    for (let i = 0; i < 3; i++) {
      observer.resize()
      mock.timers.tick(16)
    }
    assert.deepEqual(calls, [])
    mock.timers.tick(SETTLE_DEBOUNCE_MS)
    assert.deepEqual(calls, ['refresh'])

    // Past the window the watch is gone.
    calls.length = 0
    mock.timers.tick(SETTLE_MS)
    assert.deepEqual(observer.targets, [])
    html.scrollHeight = 3000
    observer.resize()
    mock.timers.tick(SETTLE_DEBOUNCE_MS)
    assert.deepEqual(calls, [])

    stop() // idempotent after the window
    off()
    unregisterHandle(handle)
  } finally {
    mock.timers.reset()
  }
})

test('stop() ends the watch before the window does (the next route change)', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const calls = []
    html.scrollHeight = 1000
    const stop = routeChanged({ refresh: () => calls.push('refresh') })
    calls.length = 0
    html.scrollHeight = 2000
    observer.resize()
    stop()
    mock.timers.tick(SETTLE_DEBOUNCE_MS)
    assert.deepEqual(calls, [])
    assert.deepEqual(observer.targets, [])
  } finally {
    mock.timers.reset()
  }
})

test('watchRouteSettle(): a fresh load runs nothing at once, then refreshes (no sync) as its height changes', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const calls = []
    const handle = fakeHandle(calls)
    const off = onRouteRefresh(() => calls.push('refresh'))
    html.scrollHeight = 864
    const stop = watchRouteSettle()
    observer.resize()
    mock.timers.tick(SETTLE_DEBOUNCE_MS)
    assert.deepEqual(calls, [])
    // React reveals the streamed section after `load`, past ScrollTrigger's own refresh.
    html.scrollHeight = 4264
    observer.resize()
    mock.timers.tick(SETTLE_DEBOUNCE_MS)
    assert.deepEqual(calls, ['refresh'])
    stop()
    off()
    unregisterHandle(handle)
  } finally {
    mock.timers.reset()
  }
})

test('one watch at a time: a nested RouteChange and the root at one commit refresh once per height change', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const calls = []
    const off = onRouteRefresh(() => calls.push('refresh'))
    html.scrollHeight = 1000
    const inner = watchRouteSettle() // the page's own <RouteChange>, first render
    const first = observer
    const outer = routeChanged() // the root's, after it
    assert.notEqual(observer, first)
    assert.deepEqual(first.targets, [])
    calls.length = 0
    html.scrollHeight = 2200
    observer.resize()
    mock.timers.tick(SETTLE_DEBOUNCE_MS)
    assert.deepEqual(calls, ['refresh'])
    // The replaced watch's stop leaves the running one alone.
    inner()
    calls.length = 0
    html.scrollHeight = 2600
    observer.resize()
    mock.timers.tick(SETTLE_DEBOUNCE_MS)
    assert.deepEqual(calls, ['refresh'])
    outer()
    off()
  } finally {
    mock.timers.reset()
  }
})

test('a watch that replaces one keeps its measured height: a change the old one had pending still refreshes', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const calls = []
    const off = onRouteRefresh(() => calls.push('refresh'))
    html.scrollHeight = 864
    const root = watchRouteSettle() // the root layout's <RouteChange>, hydrated with the skeleton
    html.scrollHeight = 4264 // React reveals the streamed content…
    observer.resize()
    const page = watchRouteSettle() // …and the page's own <RouteChange> hydrates before the debounce ran
    observer.resize() // its observer's first report
    mock.timers.tick(SETTLE_DEBOUNCE_MS)
    assert.deepEqual(calls, ['refresh'])
    page()
    root()
    off()
  } finally {
    mock.timers.reset()
  }
})
