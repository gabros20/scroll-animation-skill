// entrance-signal.ts's publishEntrance(): the contract's publisher half. The phase is written on the scope (default
// <html>) before `entrance:phase` is dispatched, it bubbles, and it never goes backwards: an earlier or equal phase
// is a no-op, `tail` may be skipped. trackEntrance() under reduced motion or a fired failsafe publishes settled at
// once and nothing else, and one stopped before it settles publishes nothing more. Its browser half (the animations
// it waits on) is tests/hero.mjs.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

/** An element with attributes and a listener list: enough for the attribute and the event. */
function element() {
  const attrs = new Map()
  const listeners = []
  return {
    dataset: {},
    events: [],
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
    addEventListener: (type, fn) => listeners.push([type, fn]),
    dispatchEvent(event) {
      this.events.push({ type: event.type, phase: event.detail.phase, bubbles: event.bubbles, attr: this.getAttribute('data-entrance') })
      for (const [type, fn] of listeners) if (type === event.type) fn(event)
      return true
    },
  }
}

let reduce = false
globalThis.window = globalThis
globalThis.matchMedia = () => ({ matches: reduce, addEventListener() {}, removeEventListener() {} })
globalThis.document = { documentElement: element() }

const { publishEntrance, readEntrance, trackEntrance } = await import('../../skills/scroll-animation/assets/entrance-signal.ts')

beforeEach(() => {
  reduce = false
  document.documentElement = element()
})

test('no attribute reads as no entrance', () => {
  assert.equal(readEntrance(), null)
})

test('each phase is written before its event, which bubbles', () => {
  const html = document.documentElement
  html.setAttribute('data-entrance', 'pending')
  publishEntrance('running')
  publishEntrance('tail')
  publishEntrance('settled')
  assert.deepEqual(
    html.events.map((e) => [e.type, e.phase, e.attr, e.bubbles]),
    [
      ['entrance:phase', 'running', 'running', true],
      ['entrance:phase', 'tail', 'tail', true],
      ['entrance:phase', 'settled', 'settled', true],
    ],
  )
})

test('never backwards: an earlier or equal phase is a no-op', () => {
  const html = document.documentElement
  publishEntrance('tail')
  publishEntrance('running')
  publishEntrance('tail')
  publishEntrance('pending')
  assert.equal(html.getAttribute('data-entrance'), 'tail')
  assert.deepEqual(html.events.map((e) => e.phase), ['tail'])
})

test('tail may be skipped', () => {
  publishEntrance('running')
  publishEntrance('settled')
  assert.deepEqual(document.documentElement.events.map((e) => e.phase), ['running', 'settled'])
})

test('a scope other than <html> takes the phase, and <html> stays as it was', () => {
  const route = element()
  publishEntrance('running', route)
  assert.equal(route.getAttribute('data-entrance'), 'running')
  assert.equal(readEntrance(), null)
})

test('trackEntrance under reduced motion: settled at once, nothing else', () => {
  reduce = true
  const html = document.documentElement
  html.setAttribute('data-entrance', 'pending')
  const stop = trackEntrance(element())
  stop()
  assert.deepEqual(html.events.map((e) => e.phase), ['settled'])
})

test('trackEntrance after the failsafe fired: settled at once, nothing else', () => {
  const html = document.documentElement
  html.dataset.animationFailsafe = ''
  trackEntrance(element())
  assert.deepEqual(html.events.map((e) => e.phase), ['settled'])
})

/** Animation frames run by hand: `flush()` runs every queued callback, the ones queued meanwhile too. */
function manualFrames() {
  const queue = []
  globalThis.requestAnimationFrame = (fn) => queue.push(fn)
  globalThis.cancelAnimationFrame = (id) => {
    queue[id - 1] = null
  }
  return {
    flush() {
      for (let i = 0; i < queue.length; i++) {
        const fn = queue[i]
        queue[i] = null
        fn?.()
      }
    },
  }
}

test('trackEntrance: a tracker stopped before it settles publishes nothing more (StrictMode and Activity re-run effects)', () => {
  const frames = manualFrames()
  const html = document.documentElement
  html.setAttribute('data-entrance', 'pending')
  const quiet = { getAnimations: () => [] } // nothing running: its first look would settle it

  // The control: left running, it settles two frames in.
  trackEntrance(quiet)
  frames.flush()
  assert.deepEqual(html.events.map((e) => e.phase), ['running', 'settled'])

  // Stopped first: running stays, and consumers fall back to their timeouts.
  document.documentElement = element()
  document.documentElement.setAttribute('data-entrance', 'pending')
  const stop = trackEntrance(quiet)
  stop()
  frames.flush()
  assert.deepEqual(document.documentElement.events.map((e) => e.phase), ['running'])
  assert.equal(document.documentElement.getAttribute('data-entrance'), 'running')
})
