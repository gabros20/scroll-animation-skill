// FrameSequence's pure half (assets/media/frame-sequence.ts): the progress → frame mapping, the variant pick, the
// fit and decode-size maths, the default budgets, the decode window and fetch orders, the byte-bounded LRU and the
// createImageBitmap resize detection. tests/sequence.mjs covers the canvas, the network and the browsers.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const {
  BitmapCache,
  MAX_CANVAS_AREA,
  MIB,
  backingSize,
  bitmapBytes,
  decodeFrame,
  decodeSize,
  defaultBudgetBytes,
  fetchOrder,
  fitRect,
  frameIndex,
  pickVariant,
  windowOrder,
} = await import('../../skills/scroll-animation/assets/media/frame-sequence.ts')

describe('frameIndex', () => {
  test('60 frames at progress 0 / .25 / .5 / .75 / 1', () => {
    assert.deepEqual(
      [0, 0.25, 0.5, 0.75, 1].map((p) => frameIndex(p, 60)),
      [0, 15, 30, 44, 59],
    )
  })

  test('clamps out-of-range and non-numbers', () => {
    assert.equal(frameIndex(-0.5, 60), 0)
    assert.equal(frameIndex(1.5, 60), 59)
    assert.equal(frameIndex(NaN, 60), 0)
    assert.equal(frameIndex(0.7, 1), 0)
    assert.equal(frameIndex(0.7, 0), 0)
  })

  test('is monotonic and reaches every frame', () => {
    const seen = new Set()
    let prev = 0
    for (let k = 0; k <= 10000; k++) {
      const i = frameIndex(k / 10000, 120)
      assert.ok(i >= prev, `frame went back at p=${k / 10000}`)
      prev = i
      seen.add(i)
    }
    assert.equal(seen.size, 120)
  })
})

describe('pickVariant', () => {
  // `media sequence --width 960 --mobile-width 480` writes these two
  const W = [960, 480]

  test('by CSS width × min(dpr, cap): the smallest wide enough', () => {
    assert.equal(pickVariant(W, 390, 1), 1) // 390 ≤ 480: mobile
    assert.equal(pickVariant(W, 390, 2), 0) // 780 > 480: primary
    assert.equal(pickVariant(W, 480, 1), 1) // exactly wide enough
    assert.equal(pickVariant(W, 400, 3, 1), 1) // dpr capped at 1: 400
    assert.equal(pickVariant(W, 390, 3), 0) // capped at 2: 780
  })

  test('none wide enough: the widest', () => {
    assert.equal(pickVariant(W, 1440, 2), 0)
    assert.equal(pickVariant([480, 960], 1440, 2), 1)
  })

  test('order-independent over more variants', () => {
    assert.equal(pickVariant([1920, 720, 1280], 1000, 1), 2)
    assert.equal(pickVariant([720, 1280, 1920], 640, 1), 0)
    assert.equal(pickVariant([1600], 390, 2), 0)
  })
})

describe('backingSize, fitRect, decodeSize', () => {
  test('backing store = CSS × min(dpr, cap), rounded', () => {
    assert.deepEqual(backingSize(1000, 600, 1), { width: 1000, height: 600 })
    assert.deepEqual(backingSize(390, 844, 3), { width: 780, height: 1688 })
    assert.deepEqual(backingSize(100.4, 50.6, 1.5), { width: 151, height: 76 })
  })

  test('never finer than the frames: a frame is never drawn larger than its own pixels', () => {
    const cover = (width, height) => ({ width, height, fit: 'cover' })
    // a retina laptop: 1600×900 frames covering 1440×900 CSS at 2× get 1440×900, not 2880×1800
    assert.deepEqual(backingSize(1440, 900, 2, 2, cover(1600, 900)), { width: 1440, height: 900 })
    // a portrait phone covered by the 900×506 mobile frames: the visible slice at the frames' own density
    assert.deepEqual(backingSize(390, 844, 3, 2, cover(900, 506)), { width: 234, height: 506 })
    // frames finer than the screen needs: the dpr cap still decides
    assert.deepEqual(backingSize(400, 225, 2, 2, cover(1600, 900)), { width: 800, height: 450 })
    // contain: capped by the letterboxed frame, so the frame itself is never shrunk to fit the cap
    assert.deepEqual(backingSize(390, 844, 2, 2, { width: 900, height: 506, fit: 'contain' }), { width: 780, height: 1688 })
    // dprCap overrides below the frame cap
    assert.deepEqual(backingSize(1440, 900, 2, 1, cover(3200, 1800)), { width: 1440, height: 900 })
    // on the capped store the frame is drawn at exactly its own size: a 1:1 blit, the upscale left to the compositor
    const b = backingSize(1440, 900, 2, 2, cover(1600, 900))
    const r = fitRect(1600, 900, b.width, b.height, 'cover')
    assert.deepEqual([Math.round(r.width), Math.round(r.height)], [1600, 900])
    assert.deepEqual(decodeSize(1600, 900, b.width, b.height, 'cover'), { width: 1600, height: 900 })
  })

  test('backing store stays under Safari’s 16.7 MP canvas limit', () => {
    const s = backingSize(5120, 2880, 2)
    assert.ok(s.width * s.height <= MAX_CANVAS_AREA * 1.001, `${s.width}×${s.height}`)
    assert.ok(Math.abs(s.width / s.height - 16 / 9) < 0.01)
  })

  test('cover overflows the box, contain letterboxes, both centred by default', () => {
    assert.deepEqual(fitRect(1600, 900, 800, 800, 'cover'), { x: -311.1111111111111, y: 0, width: 1422.2222222222222, height: 800 })
    assert.deepEqual(fitRect(1600, 900, 800, 800, 'contain'), { x: 0, y: 175, width: 800, height: 450 })
    assert.deepEqual(fitRect(1600, 900, 800, 800, 'contain', [0, 1]), { x: 0, y: 350, width: 800, height: 450 })
  })

  test('decode at the drawn size, never above the source, full size within 10%', () => {
    assert.deepEqual(decodeSize(960, 540, 800, 450, 'cover'), { width: 800, height: 450 })
    assert.deepEqual(decodeSize(960, 540, 800, 800, 'contain'), { width: 800, height: 450 })
    assert.deepEqual(decodeSize(960, 540, 2000, 1200, 'cover'), { width: 960, height: 540 }) // would upscale
    assert.deepEqual(decodeSize(1600, 900, 1500, 844, 'cover'), { width: 1600, height: 900 }) // 0.94 of the source
    assert.deepEqual(decodeSize(1600, 900, 1400, 787, 'cover'), { width: 1400, height: 788 }) // 0.875: resample
    // a portrait phone covered by a landscape frame is capped at the source: 900×506, not 3000×1688
    assert.deepEqual(decodeSize(900, 506, 780, 1688, 'cover'), { width: 900, height: 506 })
  })
})

describe('budget', () => {
  test('bitmap bytes are w × h × 4: 120 frames at 1600×900 are 690 MB', () => {
    assert.equal(bitmapBytes(1600, 900), 5_760_000)
    assert.equal(Math.round((120 * bitmapBytes(1600, 900)) / 1e6), 691)
  })

  test('default budget by navigator.deviceMemory, 64 MiB when unknown', () => {
    const table = [undefined, 0, NaN, 0.25, 0.5, 1, 2, 4, 8, 16].map((m) => defaultBudgetBytes(m) / MIB)
    assert.deepEqual(table, [64, 64, 64, 24, 24, 24, 48, 96, 192, 192])
  })

  test('the documented frames-per-budget table', () => {
    const frames = (budgetMiB, w, h) => Math.floor((budgetMiB * MIB) / bitmapBytes(w, h))
    assert.deepEqual([24, 48, 96, 192, 64].map((b) => frames(b, 1600, 900)), [4, 8, 17, 34, 11])
    assert.deepEqual([24, 48, 96, 192, 64].map((b) => frames(b, 900, 506)), [13, 27, 55, 110, 36])
  })
})

describe('windowOrder', () => {
  const contiguous = (list) => {
    const sorted = [...list].sort((a, b) => a - b)
    return sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1)
  }

  test('starts at the target, holds `capacity` distinct contiguous frames', () => {
    for (const [target, capacity, dir] of [[30, 9, 1], [30, 9, -1], [30, 8, 0], [0, 6, 1], [59, 6, 1], [2, 12, -1]]) {
      const w = windowOrder(target, 60, capacity, dir)
      assert.equal(w[0], target)
      assert.equal(w.length, capacity)
      assert.equal(new Set(w).size, capacity)
      assert.ok(contiguous(w), `${w}`)
      assert.ok(w.every((i) => i >= 0 && i < 60))
    }
  })

  test('three quarters ahead in the direction of travel, nearest first', () => {
    assert.deepEqual(windowOrder(30, 60, 9, 1), [30, 31, 32, 33, 29, 34, 35, 36, 28])
    assert.deepEqual(windowOrder(30, 60, 9, -1), [30, 29, 28, 27, 31, 26, 25, 24, 32])
  })

  test('direction unknown: half each way, ahead first on a tie', () => {
    assert.deepEqual(windowOrder(30, 60, 5, 0), [30, 31, 29, 32, 28])
  })

  test('shifted inward at the ends', () => {
    assert.deepEqual(windowOrder(59, 60, 5, 1), [59, 58, 57, 56, 55])
    assert.deepEqual(windowOrder(0, 60, 5, -1), [0, 1, 2, 3, 4])
    assert.deepEqual(windowOrder(58, 60, 5, 1).sort((a, b) => a - b), [55, 56, 57, 58, 59])
  })

  test('a budget that holds the whole sequence decodes all of it', () => {
    const w = windowOrder(10, 24, 100, 1)
    assert.deepEqual([...w].sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i))
  })
})

describe('fetchOrder', () => {
  test('a permutation: the first frame, the prefix, the last, then coarse to fine', () => {
    const order = fetchOrder(120, 12, 0)
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 120 }, (_, i) => i))
    assert.deepEqual(order.slice(0, 14), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 119, 64])
    assert.deepEqual(order.slice(14, 17), [32, 96, 16])
    // before any frame at an odd index, every frame at a multiple of 16 is in
    const firstOdd = order.findIndex((i) => i % 2 === 1 && i > 11 && i !== 119)
    assert.ok(Array.from({ length: 8 }, (_, k) => k * 16).every((i) => order.indexOf(i) < firstOdd))
  })

  test('the frame on screen at load comes first', () => {
    const order = fetchOrder(60, 12, 30)
    assert.deepEqual(order.slice(0, 3), [30, 0, 1])
    assert.equal(new Set(order).size, 60)
  })

  test('small sequences', () => {
    assert.deepEqual(fetchOrder(1, 12, 0), [0])
    assert.deepEqual(fetchOrder(3, 12, 0), [0, 1, 2])
  })
})

describe('BitmapCache', () => {
  const bitmap = (name, log) => ({ name, closes: 0, close() { this.closes++; log?.push(name) } })

  test('budget accounting: bytes, peak, and LRU eviction that closes', () => {
    const log = []
    const cache = new BitmapCache(30)
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => bitmap(n, log))
    assert.ok(cache.set(1, a, 10))
    assert.ok(cache.set(2, b, 10))
    assert.ok(cache.set(3, c, 10))
    assert.equal(cache.bytes, 30)
    assert.equal(cache.get(1), a) // 1 is now the most recently used
    assert.ok(cache.set(4, d, 10)) // evicts the LRU: 2
    assert.deepEqual(log, ['b'])
    assert.deepEqual([...cache.keys()], [3, 1, 4])
    assert.equal(cache.bytes, 30)
    assert.equal(cache.peak, 30)
    assert.equal(cache.closed, 1)
    assert.equal(b.closes, 1)
  })

  test('peek does not touch recency', () => {
    const log = []
    const cache = new BitmapCache(20)
    cache.set(1, bitmap('a', log), 10)
    cache.set(2, bitmap('b', log), 10)
    cache.peek(1)
    cache.set(3, bitmap('c', log), 10)
    assert.deepEqual(log, ['a'])
  })

  test('rank classes: lowest class first, LRU within it, Infinity never', () => {
    const log = []
    const rank = (k) => (k === 1 ? Infinity : k < 10 ? 1 : 0)
    const cache = new BitmapCache(40, rank)
    cache.set(1, bitmap('on-screen', log), 10)
    cache.set(2, bitmap('stale-in-window', log), 10)
    cache.set(10, bitmap('outside-old', log), 10)
    cache.set(11, bitmap('outside-new', log), 10)
    cache.set(3, bitmap('new', log), 10) // class 0 first, its LRU
    cache.set(4, bitmap('new2', log), 10)
    assert.deepEqual(log, ['outside-old', 'outside-new'])
    cache.set(5, bitmap('new3', log), 10) // class 0 empty: class 1's LRU
    assert.deepEqual(log, ['outside-old', 'outside-new', 'stale-in-window'])
    assert.ok(cache.has(1))
  })

  test('refuses rather than go over when only protected entries are left', () => {
    const log = []
    const cache = new BitmapCache(20, () => Infinity)
    cache.set(1, bitmap('a', log), 10)
    cache.set(2, bitmap('b', log), 10)
    const c = bitmap('c', log)
    assert.equal(cache.set(3, c, 10), false)
    assert.equal(cache.bytes, 20)
    assert.equal(c.closes, 0) // the caller's to close
    assert.deepEqual(log, [])
  })

  test('reservations count against the budget and turn into entries', () => {
    const log = []
    const cache = new BitmapCache(30)
    cache.set(1, bitmap('a', log), 10)
    cache.set(2, bitmap('b', log), 10)
    assert.ok(cache.reserve(10))
    assert.equal(cache.reserved, 10)
    assert.ok(cache.reserve(10)) // evicts 'a' to hold room for a second decode
    assert.deepEqual(log, ['a'])
    assert.ok(cache.bytes + cache.reserved <= cache.budget)
    assert.ok(cache.set(3, bitmap('c', log), 10, 10))
    assert.equal(cache.reserved, 10)
    cache.release(10)
    assert.equal(cache.reserved, 0)
    assert.equal(cache.bytes, 20)
  })

  test('replacing a key closes the old value and counts the difference', () => {
    const log = []
    const cache = new BitmapCache(25)
    cache.set(1, bitmap('small', log), 5)
    cache.set(2, bitmap('other', log), 10)
    assert.ok(cache.set(1, bitmap('big', log), 15)) // 5 → 15 fits exactly: no eviction
    assert.deepEqual(log, ['small'])
    assert.equal(cache.bytes, 25)
    assert.equal(cache.peek(1).name, 'big')
  })

  test('retain, setBudget and clear close exactly what leaves', () => {
    const log = []
    const cache = new BitmapCache(100)
    for (let i = 0; i < 6; i++) cache.set(i, bitmap(`f${i}`, log), 10)
    cache.retain((k) => k % 2 === 0)
    assert.deepEqual(log, ['f1', 'f3', 'f5'])
    cache.setBudget(20) // evicts the LRU down to it
    assert.deepEqual(log, ['f1', 'f3', 'f5', 'f0'])
    assert.equal(cache.bytes, 20)
    cache.clear()
    assert.equal(cache.size, 0)
    assert.equal(cache.bytes, 0)
    assert.equal(cache.closed, 6)
  })

  test('random operations never pass the budget and close each value once', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const budget = 100
    const protectedKey = { k: -1 }
    const cache = new BitmapCache(budget, (k) => (k === protectedKey.k ? Infinity : k % 3))
    const all = []
    let reservations = []
    for (let step = 0; step < 5000; step++) {
      const op = rand()
      const key = Math.floor(rand() * 20)
      const bytes = 5 + Math.floor(rand() * 20)
      if (op < 0.4) {
        const v = bitmap(`${step}`)
        all.push(v)
        if (!cache.set(key, v, bytes)) v.close()
      } else if (op < 0.55) {
        if (cache.reserve(bytes)) reservations.push(bytes)
      } else if (op < 0.7 && reservations.length) {
        const r = reservations.pop()
        const v = bitmap(`${step}r`)
        all.push(v)
        if (!cache.set(key, v, r, r)) v.close()
      } else if (op < 0.8) {
        cache.get(key)
      } else if (op < 0.9) {
        protectedKey.k = cache.has(key) ? key : protectedKey.k
      } else if (op < 0.95) {
        cache.delete(key)
      } else {
        cache.setBudget(budget)
      }
      assert.ok(cache.bytes + cache.reserved <= budget, `step ${step}: ${cache.bytes} + ${cache.reserved}`)
      assert.ok(cache.peak <= budget)
    }
    cache.clear()
    assert.ok(all.every((v) => v.closes === 1), 'every value closed exactly once')
  })
})

describe('decodeFrame resize detection', () => {
  const blob = { kind: 'blob' }
  // A stand-in createImageBitmap: `mode` decides what it does with the resize options.
  function stub(mode) {
    const calls = []
    globalThis.createImageBitmap = async (b, options) => {
      calls.push(options ?? null)
      if (b.bad) throw new DOMException('bad image', 'InvalidStateError')
      if (options && mode === 'reject') throw new TypeError('resize options not supported')
      const resized = options && mode === 'honour'
      return { width: resized ? options.resizeWidth : 1600, height: resized ? options.resizeHeight : 900, close() {} }
    }
    return calls
  }

  test('honoured: the resized bitmap, verdict yes', async () => {
    stub('honour')
    const support = { resize: 'unknown' }
    const b = await decodeFrame(blob, 800, 450, 'high', support)
    assert.deepEqual([b.width, b.height, support.resize], [800, 450, 'yes'])
  })

  test('ignored: the full-size bitmap is kept, verdict no, later frames skip the options', async () => {
    const calls = stub('ignore')
    const support = { resize: 'unknown' }
    const b = await decodeFrame(blob, 800, 450, 'high', support)
    assert.deepEqual([b.width, b.height, support.resize], [1600, 900, 'no'])
    await decodeFrame(blob, 800, 450, 'high', support)
    assert.deepEqual(calls.map((o) => o && o.resizeWidth), [800, null])
  })

  test('rejected: a plain retry, verdict no', async () => {
    const calls = stub('reject')
    const support = { resize: 'unknown' }
    const b = await decodeFrame(blob, 800, 450, 'high', support)
    assert.deepEqual([b.width, support.resize, calls.length], [1600, 'no', 2])
  })

  test('a bad frame throws and leaves the verdict open', async () => {
    stub('reject')
    const support = { resize: 'unknown' }
    await assert.rejects(decodeFrame({ bad: true }, 800, 450, 'high', support))
    assert.equal(support.resize, 'unknown')
  })

  test('with the verdict yes, a failure is the frame’s: no retry', async () => {
    const calls = stub('honour')
    const support = { resize: 'yes' }
    await assert.rejects(decodeFrame({ bad: true }, 800, 450, 'high', support))
    assert.equal(calls.length, 1)
  })

  test('0 × 0 decodes at full size without options', async () => {
    const calls = stub('honour')
    const b = await decodeFrame(blob, 0, 0, 'high', { resize: 'unknown' })
    assert.deepEqual([b.width, calls[0]], [1600, null])
    delete globalThis.createImageBitmap
  })

  test('decodes where `create` says (the worker), with the same detection', async () => {
    const seen = []
    const create = async (b, options) => {
      seen.push(options ?? null)
      return { width: 1600, height: 900, close() {} } // ignores the options, like the stub above
    }
    const support = { resize: 'unknown' }
    await decodeFrame(blob, 800, 450, 'medium', support, create)
    assert.deepEqual(seen, [{ resizeWidth: 800, resizeHeight: 450, resizeQuality: 'medium' }])
    assert.equal(support.resize, 'no')
  })

  test('an aborted decode (the worker stopped) is not retried and leaves the verdict open', async () => {
    let calls = 0
    const create = async () => {
      calls++
      throw new DOMException('the decode worker was stopped', 'AbortError')
    }
    const support = { resize: 'unknown' }
    await assert.rejects(decodeFrame(blob, 800, 450, 'high', support, create), { name: 'AbortError' })
    assert.deepEqual([calls, support.resize], [1, 'unknown'])
  })
})
