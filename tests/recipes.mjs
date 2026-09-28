#!/usr/bin/env node
// recipes.mjs — the layered DOM recipes in Chromium, WebKit and Firefox: assets/gsap/{parallax,colour-track,
// marquee-velocity,cursor-media,draw-on-scroll,stepped-sections}.ts and motion/Parallax.tsx. A light smoke per recipe:
// it mounts and answers the scroll or the pointer as its header says (checked in numbers), takes its reduced-motion
// fallback, leaves nothing behind after destroy() (tests/fixtures/recipes/src/harness.ts spies on listeners and
// observers, snapshots every attribute and counts triggers, Observers and tweens) and throws nothing. Builds
// tests/fixtures/recipes with Vite, serves the build with `vite preview`, prints one PASS/FAIL line per
// check/page/browser, and exits 1 on any FAIL. Needs the Playwright browsers, so it is its own script, like
// `test:rail`: `npm run test:recipes`.
//
//   node tests/recipes.mjs [--browsers chromium,webkit,firefox] [--pages parallax,…] [--only responds,reduced,…]
//
// Pages: parallax (GSAP; ?lenis runs it under Lenis), parallax-motion (React), colour-track, marquee, cursor-media,
// draw, stepped. WebKit tabs to links only with Option held, as Safari does by default, so its keyboard checks press
// Alt+Tab.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(testsDir, 'fixtures', 'recipes')
const outDir = join(testsDir, '.scratch', 'recipes-dist')

const BROWSERS = { chromium, webkit, firefox }
const PAGES = ['parallax', 'parallax-motion', 'colour-track', 'marquee', 'cursor-media', 'draw', 'stepped']
const VIEWPORT = { width: 1280, height: 800 }
/** A scrub (0.5 s of expo catch-up), a spring or a step settles well inside this. */
const SETTLE_MS = 4000

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(BROWSERS), pages: PAGES, only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--pages') out.pages = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  for (const p of out.pages) if (!PAGES.includes(p)) throw new Error(`unknown page: ${p} (${PAGES.join(', ')})`)
  return out
}

// ── build + serve ──────────────────────────────────────────────────────

function onwarn(warning, warn) {
  // Motion and the React blocks open with 'use client', meaningless outside a server-components bundler.
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  if (warning.code === 'SOURCEMAP_ERROR' && /\.tsx? \(1:0\)/.test(warning.message)) return
  warn(warning)
}

async function serve() {
  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    esbuild: { jsx: 'automatic' },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, join(fixtureRoot, `${p}.html`)])), onwarn },
    },
  })
  return preview({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
  })
}

// ── helpers ─────────────────────────────────────────────────────────────

const near = (a, b, tol = 0.5) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol
const call = (page, name, ...args) => page.evaluate(([n, a]) => window.__t[n](...a), [name, args])
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls `fn` in Node until it returns truthy; resolves with its last value and the elapsed ms (null on timeout). */
async function until(fn, timeout = SETTLE_MS) {
  const t0 = Date.now()
  let value
  while (Date.now() - t0 < timeout) {
    value = await fn()
    if (value?.ok) return { ...value, ms: Date.now() - t0 }
    await wait(50)
  }
  return { ...value, ms: null }
}

/** The scroll position once it stops changing (a native smooth scroll, a step). */
async function settledY(page, timeout = SETTLE_MS) {
  let last = await call(page, 'y')
  const t0 = Date.now()
  let still = 0
  while (Date.now() - t0 < timeout) {
    await wait(100)
    const y = await call(page, 'y')
    still = y === last ? still + 1 : 0
    last = y
    if (still >= 3) break
  }
  return last
}

/** destroy() leaves nothing: no listener, observation, attribute, trigger, Observer or tween; a second call is a no-op. */
async function destroyCheck(page) {
  await call(page, 'destroy')
  // Long enough for a catch-up tween that survived destroy() to write again.
  await wait(700)
  const left = await call(page, 'leftovers')
  const twice = await page
    .evaluate(() => {
      window.__t.destroy()
      return 'ok'
    })
    .catch((err) => err.message.split('\n')[0])
  const clean = !left.listeners.length && !left.observers.length && !left.attrs.length && !Object.keys(left.census).length
  return [
    'destroy() leaves no listeners, observers, inline styles, attributes, triggers or tweens; a second call is a no-op',
    clean && twice === 'ok',
    clean ? `second destroy: ${twice}` : JSON.stringify(left).slice(0, 1600),
  ]
}

// ── checks ──────────────────────────────────────────────────────────────
// Per page: id → run(t) → [[name, ok, detail], ...]. `t.open(options)` gives a fresh context on the page.

/** Parallax, either engine: layer 0 (speed 0.2) centred sits at its layout position, and at ¼ of its pass it has drifted. */
async function parallaxResponds(t) {
  const { page } = await t.open()
  const settle = (i) =>
    until(async () => {
      const s = await call(page, 'layer', i)
      return { ...s, ok: near(s.translate, s.expected) }
    })
  await call(page, 'toPass', 0, 0.5)
  const centred = await settle(0)
  await call(page, 'toPass', 0, 0.25)
  const quarter = await settle(0)
  await call(page, 'toPass', 1, 0.8)
  const ahead = await settle(1)
  return [
    [
      'centred in the viewport, a layer sits at its layout position (±0.5 px)',
      centred.ms !== null && Math.abs(centred.translate) <= 0.5,
      `p ${centred.p}: translate ${centred.translate} px`,
    ],
    [
      'through its pass it drifts speed × pass × (p − ½): lagging at 0.2, running ahead at −0.15 (±0.5 px)',
      quarter.ms !== null && quarter.translate < -10 && ahead.ms !== null && ahead.translate < -5,
      `0.2 at p ${quarter.p}: ${quarter.translate} (want ${quarter.expected}) · −0.15 at p ${ahead.p}: ${ahead.translate} (want ${ahead.expected})`,
    ],
  ]
}

async function parallaxReduced(t) {
  const { page } = await t.open({ reducedMotion: 'reduce' })
  const seen = []
  let ok = true
  for (const p of [0.25, 0.5, 0.9]) {
    await call(page, 'toPass', 0, p)
    await wait(300)
    for (const i of [0, 1]) {
      const s = await call(page, 'layer', i)
      ok &&= s.translate === 0 && s.inline === ''
      seen.push(`${i}@${s.p}: ${s.translate}${s.inline ? ` '${s.inline}'` : ''}`)
    }
  }
  return [['reduced motion: no drift and nothing inline, anywhere in the pass', ok, seen.join(' · ')]]
}

/** Smooth once: a jump is caught up over the scrub (native) or the spring, never at once; under Lenis, at once. */
async function parallaxSmoothing(t, { lenis = false } = {}) {
  const { page } = await t.open(lenis ? { query: '?lenis' } : {})
  await call(page, 'toPass', 0, 0.5)
  await until(async () => {
    const s = await call(page, 'layer', 0)
    return { ok: near(s.translate, s.expected) }
  })
  await call(page, 'toPass', 0, 0.2)
  const soon = await call(page, 'layer', 0)
  const later = await until(async () => {
    const s = await call(page, 'layer', 0)
    return { ...s, ok: near(s.translate, s.expected) }
  })
  if (lenis) {
    return [
      [
        'under Lenis it follows the scroll exactly: three frames after a jump the drift is already there',
        near(soon.translate, soon.expected),
        `3 frames after the jump: ${soon.translate} (want ${soon.expected})`,
      ],
    ]
  }
  return [
    [
      `on native scrolling it catches up (${t.page === 'parallax' ? '0.5 s scrub' : 'a spring'}), then lands exactly`,
      !near(soon.translate, soon.expected, 2) && later.ms !== null,
      `3 frames after the jump: ${soon.translate} (want ${soon.expected}) · landed after ${later.ms} ms at ${later.translate}`,
    ],
  ]
}

/** Reduced motion switched on and off mid-page: the drift goes and comes back, and the page never moves. */
async function parallaxLive(t) {
  const { page } = await t.open()
  await call(page, 'toPass', 0, 0.25)
  const before = await until(async () => {
    const s = await call(page, 'layer', 0)
    return { ...s, ok: near(s.translate, s.expected) }
  })
  const y0 = await page.evaluate(() => Math.round(scrollY))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await wait(600)
  const off = await call(page, 'layer', 0)
  const y1 = await page.evaluate(() => Math.round(scrollY))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const back = await until(async () => {
    const s = await call(page, 'layer', 0)
    return { ...s, ok: near(s.translate, s.expected) && s.translate !== 0 }
  })
  const y2 = await page.evaluate(() => Math.round(scrollY))
  return [
    [
      'reduced motion switched on mid-page drops the drift; switched off, it returns; the page stays put',
      before.ms !== null && off.translate === 0 && off.inline === '' && back.ms !== null && y1 === y0 && y2 === y0,
      `drift ${before.translate} → ${off.translate} ('${off.inline}') → ${back.translate} (want ${back.expected}) · scrollY ${y0} → ${y1} → ${y2}`,
    ],
  ]
}

const CHECKS = {
  parallax: {
    responds: parallaxResponds,
    smoothing: async (t) => [...(await parallaxSmoothing(t)), ...(await parallaxSmoothing(t, { lenis: true }))],
    reduced: parallaxReduced,
    live: parallaxLive,
    destroy: async (t) => {
      const { page } = await t.open()
      // Mid catch-up, as a route change during a scroll would.
      await call(page, 'toPass', 0, 0.3)
      return [await destroyCheck(page)]
    },
  },

  'parallax-motion': {
    responds: parallaxResponds,
    smoothing: (t) => parallaxSmoothing(t),
    reduced: parallaxReduced,
    live: parallaxLive,
    destroy: async (t) => {
      const { page } = await t.open()
      await call(page, 'toPass', 0, 0.3)
      return [await destroyCheck(page)]
    },
  },

  'colour-track': {
    responds: async (t) => {
      const { page } = await t.open()
      const top = await call(page, 'state')
      const blue = await call(page, 'mix', '#0000ff', '#ffff00', 0)
      const at = (h, p) =>
        until(async () => {
          const s = await call(page, 'state')
          return { ...s, ok: near(s.p, p, 0.01) }
        })
      await call(page, 'toHandover', 0, 0.5)
      const first = await at(0, 0.5)
      const oklch = await call(page, 'mix', '#0000ff', '#ffff00', first.p)
      const srgb = await call(page, 'mix', '#0000ff', '#ffff00', first.p, 'srgb')
      await call(page, 'toHandover', 1, 0.5)
      const second = await at(1, 0.5)
      const brick = await call(page, 'resolve', 'rgb(231 111 81)')
      const second_oklch = await call(page, 'mix', '#ffff00', brick, second.p)
      return [
        [
          'before the first handover the page is the first section’s colour',
          top.background === blue && top.p === 0,
          `background ${top.background} (want ${blue}), --track-p ${top.p}`,
        ],
        [
          'halfway through a handover --track-p is ½ and the background is the OKLCH mix, not the RGB one',
          first.ms !== null && first.background === oklch && first.background !== srgb,
          `--track-p ${first.p} · background ${first.background} (oklch mix ${oklch}; srgb mix ${srgb}) · a ${first.a}, b ${first.b}`,
        ],
        [
          'the next handover blends the next pair; a var() colour resolves on the target',
          second.ms !== null && second.background === second_oklch,
          `--track-p ${second.p} · a ${second.a}, b ${second.b} · background ${second.background} (want ${second_oklch})`,
        ],
      ]
    },
    smoothing: async (t) => {
      const { page } = await t.open()
      await call(page, 'toHandover', 0, 0.8)
      const soon = await call(page, 'state')
      const later = await until(async () => {
        const s = await call(page, 'state')
        return { ...s, ok: near(s.p, 0.8, 0.01) }
      })
      return [
        [
          'on native scrolling the handover catches up (0.5 s scrub), then lands exactly',
          !near(soon.p, 0.8, 0.02) && later.ms !== null,
          `3 frames after the jump: ${soon.p} · landed after ${later.ms} ms at ${later.p}`,
        ],
      ]
    },
    reduced: async (t) => {
      const { page } = await t.open({ reducedMotion: 'reduce' })
      await call(page, 'toHandover', 0, 0.3)
      const s = await call(page, 'state')
      const want = await call(page, 'mix', '#0000ff', '#ffff00', s.p)
      return [
        [
          'reduced motion: the colour stays, following the scroll exactly (no catch-up): three frames after a jump',
          near(s.p, 0.3, 0.01) && s.background === want,
          `--track-p ${s.p} · background ${s.background} (want ${want})`,
        ],
      ]
    },
    destroy: async (t) => {
      const { page } = await t.open()
      await call(page, 'toHandover', 0, 0.5)
      return [await destroyCheck(page)]
    },
  },

  marquee: {
    responds: async (t) => {
      const { page } = await t.open()
      const rest = await call(page, 'moved', 500)
      const forward = await call(page, 'fling', 2400, 400)
      const settled = await until(async () => {
        const s = await call(page, 'state')
        return { ...s, ok: near(s.timeScale, 1, 0.02) }
      })
      const backward = await call(page, 'fling', -2400, 400)
      const kept = await until(async () => {
        const s = await call(page, 'state')
        return { ...s, ok: near(s.timeScale, -1, 0.02) }
      })
      const drift = await call(page, 'moved', 500)
      return [
        [
          'at rest it runs at 1× leftwards; a fast scroll down speeds it up, then it settles back to 1×',
          rest < 0 && forward >= 2.5 && settled.ms !== null,
          `moved ${rest} px in 0.5 s · 2400 px/s down: timeScale ${forward} · settled to ${settled.timeScale} after ${settled.ms} ms`,
        ],
        [
          'a fast scroll up runs it backwards, and it keeps that direction at 1× once the scroll stops',
          backward <= -2.5 && kept.ms !== null && drift > 0,
          `2400 px/s up: timeScale ${backward} · then ${kept.timeScale} after ${kept.ms} ms, moving ${drift} px in 0.5 s`,
        ],
      ]
    },
    pauses: async (t) => {
      const { page } = await t.open()
      const box = await page.locator('#ticker').boundingBox()
      await page.mouse.move(box.x + 100, box.y + box.height / 2)
      await wait(100)
      const hovered = await call(page, 'moved', 400)
      await page.mouse.move(5, 5)
      await wait(100)
      const left = await call(page, 'moved', 400)
      // Keyboard: Tab through the six links to the last, which the 600 px frame clips at rest.
      for (let i = 0; i < 6; i++) await page.keyboard.press(t.tab)
      await wait(100)
      const focused = await call(page, 'moved', 400)
      const shows = await page.evaluate(() => {
        const frame = document.getElementById('ticker').getBoundingClientRect()
        const item = document.getElementById('last-item')
        const r = item.getBoundingClientRect()
        return { active: document.activeElement === item, inside: r.left >= frame.left - 1 && r.right <= frame.right + 1 }
      })
      await page.evaluate(() => document.activeElement.blur())
      await page.click('#toggle')
      await wait(100)
      const toggled = await call(page, 'state')
      const byChoice = await call(page, 'moved', 400)
      await page.mouse.move(box.x + 100, box.y + box.height / 2)
      await page.mouse.move(5, 5)
      const stillPaused = await call(page, 'moved', 400)
      await page.click('#toggle')
      await wait(100)
      const resumed = await call(page, 'moved', 400)
      const after = await call(page, 'state')
      return [
        [
          'it stops while hovered and while focus is inside, and runs again when they end',
          hovered === 0 && left !== 0 && focused === 0,
          `hovered ${hovered} · left ${left} · focused ${focused}`,
        ],
        [
          'Tab onto a link the frame clips: the row moves until it shows',
          shows.active && shows.inside,
          JSON.stringify(shows),
        ],
        [
          'the toggle pauses it (aria-pressed="true") through hover in and out, and plays it again',
          toggled.pressed === 'true' && toggled.paused === true && byChoice === 0 && stillPaused === 0 && resumed !== 0 && after.pressed === 'false',
          `pressed ${toggled.pressed}: moved ${byChoice}, after hover ${stillPaused} · pressed ${after.pressed}: moved ${resumed}`,
        ],
      ]
    },
    reduced: async (t) => {
      const { page } = await t.open({ reducedMotion: 'reduce' })
      const moved = await call(page, 'moved', 600)
      const fling = await call(page, 'fling', 2400, 300)
      const s = await call(page, 'state')
      await page.click('#toggle')
      await wait(100)
      const played = await call(page, 'moved', 400)
      const after = await call(page, 'state')
      return [
        [
          'reduced motion: stopped, nothing inline, the toggle pressed; the scroll does nothing',
          moved === 0 && s.inline === '' && s.pressed === 'true' && !s.running && s.x === 0,
          `moved ${moved} · fling timeScale ${fling} · inline '${s.inline}' · pressed ${s.pressed}`,
        ],
        [
          'reduced motion: the toggle still starts it, at 1×',
          played < 0 && after.pressed === 'false' && after.timeScale === 1,
          `moved ${played} · pressed ${after.pressed} · timeScale ${after.timeScale}`,
        ],
      ]
    },
    destroy: async (t) => {
      const { page } = await t.open()
      await call(page, 'fling', 1800, 300)
      await wait(300)
      return [await destroyCheck(page)]
    },
  },

  'cursor-media': {
    responds: async (t) => {
      const { page } = await t.open()
      const fine = (await call(page, 'state')).fine
      const follow = async (key) => {
        const c = await call(page, 'centre', key)
        await page.mouse.move(c.x - 20, c.y, { steps: 2 })
        await page.mouse.move(c.x, c.y, { steps: 4 })
        const want = await call(page, 'local', c.x, c.y)
        return until(async () => {
          const s = await call(page, 'state')
          return { ...s, want, ok: s.shown && s.active === key && near(s.x, want.x, 1) && near(s.y, want.y, 1) }
        })
      }
      const first = await follow('field')
      const second = await follow('tide')
      await page.mouse.move(1200, 700, { steps: 3 })
      await wait(100)
      const gone = await call(page, 'state')
      return [
        [
          'under (hover: hover) and (pointer: fine), an item shows its media at the pointer and follows it (±1 px)',
          fine && first.ms !== null && second.ms !== null,
          `field: (${first.x}, ${first.y}) want (${first.want.x}, ${first.want.y}) in ${first.ms} ms · tide: (${second.x}, ${second.y}) want (${second.want.x}, ${second.want.y}), ${second.active}`,
        ],
        ['off the list the preview hides', !gone.shown, JSON.stringify({ shown: gone.shown, active: gone.active })],
      ]
    },
    keyboard: async (t) => {
      const { page } = await t.open()
      for (let i = 0; i < 3; i++) await page.keyboard.press(t.tab)
      const focused = await call(page, 'focused')
      const want = await call(page, 'end', 'tide')
      const s = await until(async () => {
        const v = await call(page, 'state')
        return { ...v, ok: v.shown && v.active === 'tide' && near(v.x, want.x, 1) && near(v.y, want.y, 1) }
      })
      return [
        [
          'keyboard focus shows the media at the focused item (its end, centred), not at the pointer',
          focused === 'tide' && s.ms !== null,
          `focus on ${focused} · preview (${s.x}, ${s.y}) want (${want.x}, ${want.y}), ${s.active}`,
        ],
      ]
    },
    reduced: async (t) => {
      const { page } = await t.open({ reducedMotion: 'reduce' })
      const c = await call(page, 'centre', 'field')
      await page.mouse.move(c.x, c.y, { steps: 3 })
      await call(page, 'frames', 2)
      const want = await call(page, 'end', 'field')
      const s = await call(page, 'state')
      await page.mouse.move(c.x - 40, c.y + 4, { steps: 3 })
      await wait(300)
      const s2 = await call(page, 'state')
      return [
        [
          'reduced motion: no following; the media shows at the item at once and stays put as the pointer moves',
          s.shown && s.active === 'field' && near(s.x, want.x, 1) && near(s.y, want.y, 1) && s2.x === s.x && s2.y === s.y,
          `at once (${s.x}, ${s.y}) want (${want.x}, ${want.y}) · after the pointer moved (${s2.x}, ${s2.y})`,
        ],
      ]
    },
    destroy: async (t) => {
      const { page } = await t.open()
      // Mid-glide from one item to the next.
      const a = await call(page, 'centre', 'field')
      await page.mouse.move(a.x, a.y, { steps: 3 })
      await wait(600)
      const b = await call(page, 'centre', 'north')
      await page.mouse.move(b.x, b.y, { steps: 2 })
      return [await destroyCheck(page)]
    },
  },

  draw: {
    responds: async (t) => {
      const { page } = await t.open()
      const reach = (id, want) =>
        until(async () => {
          const shapes = await call(page, 'drawn', id)
          return { shapes, ok: shapes.every((s, i) => near(s.fraction, want[i], 0.02)) }
        })
      await call(page, 'toPass', 'wave', 0.5)
      const half = await reach('wave', [0.5])
      await call(page, 'toPass', 'pair', 0.75)
      const pair = await reach('pair', [1, 0.5])
      await call(page, 'toPass', 'wave', 1.2)
      const full = await reach('wave', [1])
      const f = (r) => r.shapes.map((s) => s.fraction).join(', ')
      return [
        [
          'halfway through its pass a path is half drawn; two shapes in one svg draw one after the other',
          half.ms !== null && pair.ms !== null,
          `wave at ½: ${f(half)} · pair at ¾: ${f(pair)}`,
        ],
        ['past its pass a path is fully drawn (Firefox included)', full.ms !== null, `wave: ${f(full)}`],
      ]
    },
    reduced: async (t) => {
      const { page } = await t.open({ reducedMotion: 'reduce' })
      await call(page, 'toPass', 'wave', 0.3)
      await wait(300)
      const shapes = [...(await call(page, 'drawn', 'wave')), ...(await call(page, 'drawn', 'pair'))]
      return [
        [
          'reduced motion: every shape fully drawn, nothing inline',
          shapes.every((s) => s.fraction === 1 && s.inline === ''),
          JSON.stringify(shapes),
        ],
      ]
    },
    destroy: async (t) => {
      const { page } = await t.open()
      await call(page, 'toPass', 'wave', 0.4)
      return [await destroyCheck(page)]
    },
  },

  stepped: {
    responds: async (t) => {
      const { page } = await t.open()
      const tops = await call(page, 'tops')
      const view = await call(page, 'view')
      await page.mouse.move(640, 400)
      await page.mouse.wheel(0, 100)
      const one = await settledY(page)
      await wait(300)
      await page.mouse.wheel(0, 100)
      const two = await settledY(page)
      await wait(300)
      // The third section is 2.5 viewports tall: a viewport at a time, then its end, then the fourth.
      await page.mouse.wheel(0, 100)
      const three = await settledY(page)
      await wait(300)
      await page.mouse.wheel(0, 100)
      const four = await settledY(page)
      await wait(300)
      await page.mouse.wheel(0, 100)
      const five = await settledY(page)
      return [
        [
          'a wheel notch steps to the next section, one per notch',
          one === tops[1] && two === tops[2],
          `tops ${tops.join(', ')} · notches → ${one}, ${two}`,
        ],
        [
          'a section taller than the viewport is stepped through a viewport at a time, to its end',
          three === tops[2] + view && four === tops[3] - view && five === tops[3],
          `→ ${three} (want ${tops[2] + view}), ${four} (want ${tops[3] - view}), ${five} (want ${tops[3]})`,
        ],
      ]
    },
    keys: async (t) => {
      const { page } = await t.open()
      const tops = await call(page, 'tops')
      const seen = []
      const press = async (key, want) => {
        await page.keyboard.press(key)
        const y = await settledY(page)
        seen.push(`${key} → ${y}${y === want ? '' : ` (want ${want})`}`)
        return y === want
      }
      let ok = await press('PageDown', tops[1])
      ok = (await press('ArrowDown', tops[2])) && ok
      ok = (await press('End', tops[3])) && ok
      ok = (await press('ArrowUp', tops[3] - (await call(page, 'view')))) && ok
      ok = (await press('Home', 0)) && ok
      ok = (await press('Space', tops[1])) && ok
      ok = (await press('Shift+Space', 0)) && ok
      return [['PageDown, ArrowDown, End, ArrowUp, Home, Space and Shift+Space step', ok, seen.join(' · ')]]
    },
    edges: async (t) => {
      const { page } = await t.open()
      const tops = await call(page, 'tops')
      await page.keyboard.press('End')
      const last = await settledY(page)
      await page.mouse.move(640, 400)
      await page.mouse.wheel(0, 100)
      const past = await settledY(page)
      // Tab to the link far down the tall section: the stop that shows it.
      await page.keyboard.press('Home')
      await settledY(page)
      for (let i = 0; i < 2; i++) await page.keyboard.press(t.tab)
      const focused = await call(page, 'focused')
      const y = await settledY(page)
      const rect = await call(page, 'rect', 'deep-link')
      const view = await call(page, 'view')
      const stops = [...tops, tops[2] + view, tops[3] - view]
      return [
        [
          'past the last stop the wheel scrolls natively, out of the presentation',
          last === tops[3] && past > last && !stops.includes(past),
          `End → ${last} · a notch past it → ${past}`,
        ],
        [
          'keyboard focus far down a tall section scrolls the stop that shows it into place',
          focused === 'deep-link' && stops.includes(y) && rect.top >= 0 && rect.bottom <= view,
          `focus on ${focused} · scrollY ${y} (stops ${stops.join(', ')}) · link at ${rect.top}–${rect.bottom}`,
        ],
      ]
    },
    reduced: async (t) => {
      const { page } = await t.open({ reducedMotion: 'reduce' })
      const tops = await call(page, 'tops')
      await page.mouse.move(640, 400)
      await page.mouse.wheel(0, 100)
      const wheel = await settledY(page)
      await page.keyboard.press('PageDown')
      const key = await settledY(page)
      return [
        [
          'reduced motion: the wheel and the keys scroll natively, stepping nothing',
          wheel > 0 && !tops.includes(wheel) && key > wheel && !tops.includes(key),
          `a notch → ${wheel} · PageDown → ${key} (section tops ${tops.join(', ')})`,
        ],
      ]
    },
    destroy: async (t) => {
      const { page } = await t.open()
      await page.mouse.move(640, 400)
      await page.mouse.wheel(0, 100)
      await settledY(page)
      // Mid-step: destroy() stops the step where it is, and the page stays there.
      await page.mouse.wheel(0, 100)
      await wait(120)
      const at = await page.evaluate(() => {
        const y = Math.round(scrollY)
        window.__t.destroy()
        return y
      })
      await wait(600)
      const after = await call(page, 'y')
      return [
        [
          'destroy() mid-step stops the step, and the page stays where it was',
          after === at && at > 800 && at < 1600,
          `scrollY ${at} at destroy → ${after} 0.6 s later`,
        ],
        await destroyCheck(page),
      ]
    },
  },
}

// ── run ─────────────────────────────────────────────────────────────────

const open = { browser: null, server: null }
async function shutdown() {
  await open.browser?.close().catch(() => {})
  open.browser = null
  if (open.server) {
    open.server.httpServer.closeAllConnections?.()
    await new Promise((resolve) => open.server.httpServer.close(() => resolve()))
    open.server = null
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await shutdown()
    process.exit(130)
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  open.server = await serve()
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`

  let failures = 0
  const counts = {}
  const line = (ok, browser, pageName, name, detail) => {
    counts[browser] ??= { pass: 0, fail: 0 }
    counts[browser][ok ? 'pass' : 'fail']++
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${pageName.padEnd(15)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  for (const browserName of args.browsers) {
    open.browser = await BROWSERS[browserName].launch()
    for (const pageName of args.pages) {
      const errors = []
      for (const [id, run] of Object.entries(CHECKS[pageName])) {
        if (args.only && !args.only.includes(id)) continue
        const contexts = []
        const t = {
          browser: browserName,
          page: pageName,
          tab: browserName === 'webkit' ? 'Alt+Tab' : 'Tab',
          /** A fresh context on this page with the recipe mounted and the page settled. */
          async open({ reducedMotion = 'no-preference', query = '' } = {}) {
            const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion })
            contexts.push(context)
            const page = await context.newPage()
            page.on('pageerror', (err) => errors.push(`${id}: ${err.message.split('\n')[0]}`))
            page.on('console', (msg) => msg.type() === 'error' && errors.push(`${id}: console: ${msg.text().split('\n')[0]}`))
            await page.goto(`${base}/${pageName}.html${query}`, { waitUntil: 'load' })
            await page.waitForFunction(() => !!window.__t)
            await page.evaluate(() => document.fonts.ready.then(() => window.__t.frames(3)))
            // The load-time refreshes (ScrollTrigger's own on load) land before anything is measured.
            await wait(300)
            return { page }
          },
        }
        try {
          for (const [name, ok, detail] of await run(t)) line(ok, browserName, pageName, name, detail)
        } catch (err) {
          line(false, browserName, pageName, id, err.message.split('\n')[0])
        } finally {
          for (const context of contexts) await context.close().catch(() => {})
        }
      }
      if (!args.only) line(errors.length === 0, browserName, pageName, 'no uncaught errors or console errors', errors.slice(0, 3).join(' | '))
    }
    await open.browser.close()
    open.browser = null
  }
  console.log(`\n${Object.entries(counts).map(([b, c]) => `${b}: ${c.pass} passed, ${c.fail} failed`).join(' · ')}`)
  return failures
}

let failures = 1
try {
  failures = await main()
} catch (err) {
  console.error(err)
} finally {
  await shutdown()
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall recipe checks passed')
process.exit(failures ? 1 : 0)
