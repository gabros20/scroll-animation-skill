// page.ts, the page lifecycle, on a stand-in DOM: a push starts pending and held and turns running when its holds
// release; a hold keeps it pending until released or capped; a traverse arrives settled; when() resolves at or past
// the phase, 'stale' when a new visit begins, 'timeout' counted from `running`; the start queue runs in order after
// settled. The browser half (a real router, a view transition, the reveals) is tests/route-hygiene.mjs, F3 to F5.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

class Html extends EventTarget {
  attrs = new Map()
  dataset = {}
  scrollHeight = 1000
  getAttribute = (name) => (this.attrs.has(name) ? this.attrs.get(name) : null)
  setAttribute = (name, value) => this.attrs.set(name, String(value))
  removeAttribute = (name) => this.attrs.delete(name)
  matches = () => false
}
globalThis.CustomEvent ??= class extends Event {
  constructor(type, init) {
    super(type, init)
    this.detail = init?.detail
  }
}
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const html = new Html()
const frames = []
globalThis.window = globalThis
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
globalThis.location = { pathname: '/' }
globalThis.addEventListener = () => {}
globalThis.requestAnimationFrame = (fn) => frames.push(fn)
globalThis.cancelAnimationFrame = (id) => (frames[id - 1] = () => {})
globalThis.document = {
  documentElement: html,
  body: { getAnimations: () => [] },
  visibilityState: 'visible',
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
}
/** Runs the frames queued so far, `count` times over. */
const tick = (count = 1) => {
  for (let i = 0; i < count; i++) frames.splice(0).forEach((fn) => fn(0))
}
const flush = () => new Promise((resolve) => setImmediate(resolve))
const phase = () => html.getAttribute('data-entrance')

const { page } = await import('../../skills/scroll-animation/assets/page.ts')

test('a page with no entrance reads settled, and the first call stamps the load visit', async () => {
  assert.equal(page.phase(), 'settled')
  assert.equal(page.visit().kind, 'load')
  assert.equal(html.getAttribute('data-visit-kind'), 'load')
  assert.equal(await page.when('settled'), 'phase')
})

test('a push starts pending and held, runs once placed, and settles when nothing animates', async () => {
  const visit = page.begin('push')
  assert.equal(visit.kind, 'push')
  assert.equal(phase(), 'pending')
  assert.equal(html.getAttribute('data-entrance-held'), 'pause')
  const running = page.when('running')
  page.placed()
  assert.equal(phase(), 'running')
  assert.equal(html.getAttribute('data-entrance-held'), null)
  assert.ok(Number.isFinite(page.visit().startedAt))
  assert.equal(await running, 'phase')
  tick(3)
  assert.equal(phase(), 'settled')
})

test('a hold keeps the visit pending until released; its cap releases a stuck one', () => {
  page.begin('push')
  const release = page.hold('loader')
  page.placed()
  assert.equal(phase(), 'pending')
  release()
  assert.equal(phase(), 'running')

  page.begin('push')
  page.hold('stuck', undefined, { capMs: 300 })
  page.placed()
  assert.equal(phase(), 'pending')
  mock.timers.tick(300)
  assert.equal(phase(), 'running')
})

test('a traverse arrives settled, with no hold', () => {
  const visit = page.begin('traverse')
  assert.equal(visit.kind, 'traverse')
  assert.equal(phase(), 'settled')
  assert.equal(html.getAttribute('data-entrance-held'), null)
})

test('when(): stale when a new visit begins; timeout counted from running', async () => {
  page.begin('push')
  const stale = page.when('settled')
  page.begin('push')
  assert.equal(await stale, 'stale')

  // A claimed entrance that never settles: the lifecycle's own tracker stands down, and the timeout counts from
  // `running`, not from the call.
  html.setAttribute('data-entrance-claimed', '')
  const release = page.hold('loader', undefined, { capMs: 5000 })
  let result = null
  page.when('settled', { timeoutMs: 500 }).then((r) => (result = r))
  mock.timers.tick(1000)
  await flush()
  assert.equal(phase(), 'pending')
  assert.equal(result, null, 'no clock before running')
  release()
  assert.equal(phase(), 'running')
  mock.timers.tick(499)
  await flush()
  assert.equal(result, null)
  mock.timers.tick(1)
  await flush()
  assert.equal(result, 'timeout')
})

test('afterSettled runs starts in order, one per task, only once settled', async () => {
  page.begin('push')
  const ran = []
  page.afterSettled(() => ran.push('b'), { order: 2 })
  page.afterSettled(() => ran.push('a'), { order: 1 })
  page.placed()
  await flush()
  assert.deepEqual(ran, [])
  tick(3)
  assert.equal(phase(), 'settled')
  await flush()
  mock.timers.tick(0)
  assert.deepEqual(ran, ['a'])
  tick(2)
  mock.timers.tick(0)
  assert.deepEqual(ran, ['a', 'b'])
})
