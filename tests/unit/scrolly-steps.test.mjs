// scrolly-steps.ts's pure parts: the line, the active step's resolution (the step at the line, the one above a gap,
// step 0 before the first and the last after the end, keyboard focus), the direction of a change, --step-p and the
// observers' two regions. The browser half is tests/scrolly-steps.mjs.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { test } from 'node:test'

const { DEFAULT_LINE, directionOf, lineY, parseLine, regionMargins, resolveActive, stepAtLine, stepProgress } = await import(
  '../../skills/scroll-animation/assets/scrolly-steps.ts'
)

test('data-scrolly-line is a percentage of the viewport below the header', () => {
  assert.equal(parseLine('40'), 0.4)
  assert.equal(parseLine(' 40% '), 0.4)
  assert.equal(parseLine('0'), 0)
  assert.equal(parseLine('100'), 1)
  for (const bad of [null, undefined, '', 'middle', '-5', '120', 'NaN']) assert.equal(parseLine(bad), null, String(bad))
  assert.equal(DEFAULT_LINE, 0.5)
})

test('the line sits its fraction of the way down the viewport below the header', () => {
  assert.equal(lineY(800, 0, 0.5), 400)
  assert.equal(lineY(800, 64, 0.5), 432, 'the middle of the sticky graphic under a 64 px header')
  assert.equal(lineY(800, 64, 0), 64, '0 is the header bottom')
  assert.equal(lineY(800, 64, 1), 800)
  assert.equal(lineY(50, 64, 0.5), 64, 'a header taller than the viewport pins the line to its bottom edge')
})

test('the active step is the last whose top has reached the line', () => {
  const tops = [-900, -200, 300, 900]
  assert.equal(stepAtLine(tops, 400), 2, 'step 2 under the line')
  assert.equal(stepAtLine(tops, 299), 1, 'in the gap above step 2: the step above the gap stays')
  assert.equal(stepAtLine(tops, 300), 2, 'a top exactly at the line has reached it')
})

test('before the first step, step 0; after the last, the last', () => {
  assert.equal(stepAtLine([500, 1200, 1900], 400), 0, 'nothing has reached the line yet: step 0, never an empty graphic')
  assert.equal(stepAtLine([-3000, -2000, -1000], 400), 2, 'every step passed: the last stays')
  assert.equal(stepAtLine([], 400), 0, 'no steps')
})

test('a jump resolves straight to the step it lands on', () => {
  // From step 0 under the line to a position past four steps: one answer, no intermediate steps.
  assert.equal(stepAtLine([-3200, -2400, -1600, -800, 100, 900], 400), 4)
})

test('keyboard focus inside a step makes it active while it is on screen', () => {
  const tops = [-500, 200, 700]
  assert.equal(resolveActive(tops, 400, 2, true), 2, 'focused below the line, on screen: active although the line did not move')
  assert.equal(resolveActive(tops, 400, 2, false), 1, 'the focused step scrolled away: the line decides again')
  assert.equal(resolveActive(tops, 400, null, true), 1, 'no focus: the line')
  assert.equal(resolveActive(tops, 400, 7, true), 1, 'an index that is no longer a step: the line')
})

test('direction: down to a later step, up to an earlier one, null on the first report', () => {
  assert.equal(directionOf(0, 1), 'down')
  assert.equal(directionOf(1, 4), 'down', 'a jump forward')
  assert.equal(directionOf(3, 2), 'up')
  assert.equal(directionOf(null, 3), null, 'the mount report')
  assert.equal(directionOf(2, 2), null)
})

test('--step-p runs 0..1 from the step top at the line to the next step top there, clamped', () => {
  assert.equal(stepProgress(400, 1000, 400), 0)
  assert.equal(stepProgress(100, 700, 400), 0.5)
  assert.equal(stepProgress(-600, 0, 400), 1, 'past its end')
  assert.equal(stepProgress(500, 1100, 400), 0, 'before its top reaches the line')
  assert.equal(stepProgress(300, 300, 400), 1, 'a zero-height span past the line')
  assert.equal(stepProgress(500, 500, 400), 0)
  // Monotonic as the page scrolls down (every top moves up together).
  let last = -1
  for (let scroll = 0; scroll <= 1200; scroll += 7) {
    const p = stepProgress(800 - scroll, 1400 - scroll, 400)
    assert.ok(p >= last, `monotonic at ${scroll}`)
    last = p
  }
  assert.equal(last, 1)
})

test('the two regions split the viewport at the line, as percentages of the root', () => {
  assert.deepEqual(regionMargins(0.5), { above: '0px 0px -50% 0px', below: '-50% 0px 0px 0px' })
  assert.deepEqual(regionMargins(0.54), { above: '0px 0px -46% 0px', below: '-54% 0px 0px 0px' })
  // A line at an edge keeps both regions a sliver tall: a zero-height root reports nothing reliably.
  assert.deepEqual(regionMargins(0), { above: '0px 0px -99.9% 0px', below: '-0.1% 0px 0px 0px' })
  assert.deepEqual(regionMargins(1), { above: '0px 0px -0.1% 0px', below: '-99.9% 0px 0px 0px' })
})
