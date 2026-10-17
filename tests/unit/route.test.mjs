// smooth/route.ts's routeChanged(): the page's live authority takes up the router's position first, then the
// page's triggers re-measure, once. With no authority running there is nothing to sync, and the refresh still runs.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.window = globalThis
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
globalThis.document = { documentElement: { dataset: {}, classList: { contains: () => false } } }

const { registerHandle, unregisterHandle } = await import('../../skills/scroll-animation/assets/smooth/authority.ts')
const { routeChanged } = await import('../../skills/scroll-animation/assets/smooth/route.ts')

function fakeHandle(calls) {
  const handle = { authority: 'lenis', scrollTo() {}, stop() {}, start() {}, destroy() {}, sync: () => calls.push('sync') }
  registerHandle(handle)
  return handle
}

test('the authority syncs before the one refresh', () => {
  const calls = []
  const handle = fakeHandle(calls)
  routeChanged({ refresh: () => calls.push('refresh') })
  assert.deepEqual(calls, ['sync', 'refresh'])
  unregisterHandle(handle)
})

test('no refresh given: the authority still syncs (a vanilla page whose mount() refreshes)', () => {
  const calls = []
  const handle = fakeHandle(calls)
  routeChanged()
  assert.deepEqual(calls, ['sync'])
  unregisterHandle(handle)
})

test('no authority running: the refresh alone', () => {
  const calls = []
  routeChanged({ refresh: () => calls.push('refresh') })
  assert.deepEqual(calls, ['refresh'])
})
