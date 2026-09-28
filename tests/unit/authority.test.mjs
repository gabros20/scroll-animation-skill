// smooth/authority.ts's getScrollAuthority(): the skill's stamp first, then a Lenis the skill didn't start, which
// stamps nothing but marks <html> with its own `lenis` class. The scroll well and the recipes read it to stand down
// or to pick their scrub, so a site's own Lenis must read as `lenis`, never as native.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { test } from 'node:test'

const classes = new Set()
const dataset = {}
globalThis.window = globalThis
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
globalThis.document = { documentElement: { dataset, classList: { contains: (name) => classes.has(name) } } }

const { getScrollAuthority } = await import('../../skills/scroll-animation/assets/smooth/authority.ts')

function page({ stamp, lenisClass = false }) {
  for (const key of Object.keys(dataset)) delete dataset[key]
  classes.clear()
  if (stamp) dataset.scrollAuthority = stamp
  if (lenisClass) classes.add('lenis')
}

test('no stamp and no Lenis: native', () => {
  page({})
  assert.equal(getScrollAuthority(), 'native')
})

test("a site's own Lenis (its html.lenis class, no stamp) owns the scroll", () => {
  page({ lenisClass: true })
  assert.equal(getScrollAuthority(), 'lenis')
})

test('the stamp wins over the class', () => {
  page({ stamp: 'smoother', lenisClass: true })
  assert.equal(getScrollAuthority(), 'smoother')
  page({ stamp: 'native', lenisClass: true })
  assert.equal(getScrollAuthority(), 'native', 'an explicit native stamp is the page saying so')
})

test('the skill’s own stamps read as themselves', () => {
  page({ stamp: 'lenis' })
  assert.equal(getScrollAuthority(), 'lenis')
  page({ stamp: 'smoother' })
  assert.equal(getScrollAuthority(), 'smoother')
})
