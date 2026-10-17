#!/usr/bin/env node
// usegsap-teardown.mjs — every GSAP block under React 19's useGSAP (@gsap/react 2.1), whose context reverts what it
// recorded (the block's tweens, ScrollTriggers, matchMedia and SplitText) BEFORE the cleanup the callback returned,
// the block's destroy(): the reverse of mount()'s order (measured on GSAP 3.15.0). One React page
// (tests/fixtures/usegsap-teardown) mounts one block per load, `useGSAP(() => { const b = block(ref.current!);
// return () => b?.destroy() }, { scope })`, with StrictMode off and on, and for each:
//
//   unmount   after scrolling or interacting into a live state (an entrance in flight, a catch-up, a step): no
//             trigger, Observer, tween or ticker listener left (at once, and 0.7 s on), no listener, observation or
//             interval, and every attribute and inline style as it was before the block mounted (the block's
//             subtree is kept detached and compared too); an identity transform or a will-change counts.
//   activity  <Activity mode="hidden">, at rest and in a live state: the same, on the DOM React keeps; shown again,
//             the same counts as a fresh mount, and the block answers the scroll or the pointer again.
//   remount   a fresh element after an unmount: the same counts as the first mount, and the block works.
//   strict    the whole run again under <StrictMode> (double effects).
//
// Builds the fixture with Vite, serves the build with `vite preview`, prints one PASS/FAIL line per
// block/mode/browser, a table, and exits 1 on any FAIL. Needs the Playwright browsers and ffmpeg (the clip and the
// frames): `npm run test:usegsap-teardown`.
//
//   node tests/usegsap-teardown.mjs [--browsers chromium,webkit,firefox] [--blocks reveal,…] [--strict off,on]
//
// Default: Chromium runs every block; WebKit and Firefox the blocks whose teardown touches media or SplitText.

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(testsDir, '..')
const fixtureRoot = join(testsDir, 'fixtures', 'usegsap-teardown')
const scratch = join(testsDir, '.scratch', 'usegsap-teardown')
const outDir = join(scratch, 'dist')
const publicDir = join(scratch, 'public')

const BROWSERS = { chromium, webkit, firefox }
const BLOCKS = [
  'reveal',
  'split-reveal',
  'pinned-scene',
  'horizontal-rail',
  'scrub-video',
  'frame-sequence',
  'loop-video',
  'parallax',
  'colour-track',
  'draw-on-scroll',
  'marquee-velocity',
  'cursor-media',
  'stepped-sections',
  'scroll-well',
  'flip-transition',
]
/** Teardowns that touch media or SplitText: the engines differ there, so these run in WebKit and Firefox too. */
const EVERY_ENGINE = ['split-reveal', 'scrub-video', 'frame-sequence', 'loop-video']
const VIEWPORT = { width: 1280, height: 800 }
const SETTLE_MS = 700
/** Before a count: a mount-time entrance (1.3 s) has landed. */
const COUNT_MS = 2000

/**
 * Attributes a block leaves on purpose, by block: media state, not motion. A source, a poster and the preload hint
 * stay on a video so a route shown again doesn't fetch it again; the canvas keeps its backing store and the frame it
 * drew (an Activity hide keeps the picture: tests/sequence.mjs). Anything else left behind fails.
 */
const KEPT = {
  // Shown stays shown: the item's resting state is css/reveal.css's, and a route shown again never replays it.
  reveal: ['data-reveal-state'],
  'scrub-video': ['src', 'poster', 'preload'],
  'frame-sequence': ['width', 'height', 'data-frame'],
  'loop-video': ['preload'],
}

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(BROWSERS), blocks: null, strict: ['off', 'on'] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--blocks') out.blocks = argv[++i].split(',')
    else if (a === '--strict') out.strict = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  for (const b of out.blocks ?? []) if (!BLOCKS.includes(b)) throw new Error(`unknown block: ${b} (${BLOCKS.join(', ')})`)
  for (const s of out.strict) if (s !== 'off' && s !== 'on') throw new Error(`--strict takes off,on`)
  return out
}

// ── media ───────────────────────────────────────────────────────────────

/** The 2 s, 30 fps all-intra test clip and its 60 frames, from earlier runs of the media suites when they exist. */
function makeMedia() {
  mkdirSync(publicDir, { recursive: true })
  const clip = join(publicDir, 'clip.mp4')
  if (!existsSync(clip)) {
    const made = join(testsDir, '.scratch', 'scrub-video-public', 'clip.mp4')
    if (existsSync(made)) copyFileSync(made, clip)
    else {
      execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=2', '-g', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clip])
    }
  }
  const seq = join(publicDir, 'seq')
  const ok = (dir) => existsSync(join(dir, 'manifest.json')) && JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).count === 60
  if (ok(seq)) return
  const made = join(testsDir, '.scratch', 'sequence', 'public', 'seq')
  if (ok(made)) return cpSync(made, seq, { recursive: true })
  const source = join(scratch, 'seq-source.mp4')
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=2', '-pix_fmt', 'yuv420p', source])
  const cli = join(repoRoot, 'skills', 'scroll-animation', 'bin', 'scroll-animation')
  execFileSync(process.execPath, [cli, 'media', 'sequence', source, '--out', seq, '--frames', '60', '--width', '960', '--mobile-width', '480'], { stdio: 'ignore' })
}

// ── build + serve ──────────────────────────────────────────────────────

function onwarn(warning, warn) {
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  if (warning.code === 'SOURCEMAP_ERROR' && /\.tsx? \(1:0\)/.test(warning.message)) return
  warn(warning)
}

async function serve() {
  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    publicDir,
    esbuild: { jsx: 'automatic' },
    build: { outDir, emptyOutDir: true, minify: false, rollupOptions: { input: join(fixtureRoot, 'index.html'), onwarn } },
  })
  return preview({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
  })
}

// ── page helpers ────────────────────────────────────────────────────────

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const t = (page, name, ...args) => page.evaluate(([n, a]) => window.__t[n](...a), [name, args])
const frames = (page, n = 2) =>
  page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let i = 0
        const step = () => (++i >= n ? resolve() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      }),
    n,
  )
async function settle(page, ms = SETTLE_MS) {
  await wait(ms)
  await frames(page)
}

/** Polls a page function until it returns { ok: true }; its last value, with ms (null on timeout). */
async function until(page, fn, arg, timeout = 5000) {
  const t0 = Date.now()
  let value
  while (Date.now() - t0 < timeout) {
    value = await page.evaluate(fn, arg)
    if (value?.ok) return { ...value, ms: Date.now() - t0 }
    await wait(60)
  }
  return { ...value, ms: null }
}

/** Puts element `id`'s top at `at` × the viewport's height (an instant scroll), then lets ScrollTrigger see it. */
async function topAt(page, id, at) {
  await page.evaluate(
    ([id, at]) => {
      const el = document.getElementById(id)
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - at * innerHeight, behavior: 'instant' })
    },
    [id, at],
  )
  await frames(page, 3)
}
async function scrollTop(page, y = 0) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y)
  await frames(page, 3)
}
/** A range wrapper (a scene, the sequence's range) scrolled to progress p: its top at −p × (height − viewport). */
async function rangeAt(page, id, p) {
  await page.evaluate(
    ([id, p]) => {
      const el = document.getElementById(id)
      const top = el.getBoundingClientRect().top + window.scrollY
      window.scrollTo({ top: top + p * (el.offsetHeight - innerHeight), behavior: 'instant' })
    },
    [id, p],
  )
  await frames(page, 3)
}
const rangeProgress = (id) => {
  const r = document.getElementById(id).getBoundingClientRect()
  return Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)))
}
async function centreOf(page, id) {
  return page.evaluate((id) => {
    const r = document.getElementById(id).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, id)
}

// ── per block: a live state to tear down from, and proof it works again ─────────────────────────────
// exercise(page) leaves the block mid-something; works(page) → [ok, detail] on a block that was shown again or
// remounted.

const CASES = {
  reveal: {
    async exercise(page) {
      await topAt(page, 'ga', 0.5)
      await wait(150) // entrances in flight
    },
    async works(page) {
      await topAt(page, 'gb', 0.5)
      const r = await until(page, () => {
        const items = Array.from(document.querySelectorAll('#gb [data-reveal-item]'))
        const shown = items.filter((el) => el.getAttribute('data-reveal-state') === 'shown' && !el.hasAttribute('style'))
        return { ok: shown.length === items.length, detail: `${shown.length}/${items.length} shown, nothing inline` }
      })
      return [r.ms !== null, r.detail]
    },
  },
  'split-reveal': {
    async exercise(page) {
      await topAt(page, 's1', 0.5)
      await wait(150)
    },
    async works(page) {
      await topAt(page, 's3', 0.4)
      const r = await until(page, () => {
        const done = ['s3', 's4'].map((id) => !!window.__t.handle(id)?.done)
        return { ok: done.every(Boolean), detail: `s3 done ${done[0]}, s4 done ${done[1]}` }
      })
      return [r.ms !== null, r.detail]
    },
  },
  'pinned-scene': {
    async exercise(page) {
      await rangeAt(page, 'scene', 0.55)
      await wait(100)
    },
    works: (page) => sceneWorks(page, 'scene'),
  },
  'horizontal-rail': {
    async exercise(page) {
      await rangeAt(page, 'scene', 0.5)
      await wait(100)
    },
    async works(page) {
      await rangeAt(page, 'scene', 0.5)
      const r = await until(page, () => {
        const d = window.__t.handle('rail')?.debug()
        return { ok: !!d && d.travel > 100 && Math.abs(d.translate) > 50, detail: `travel ${d?.travel}, translate ${d?.translate}, writer ${d?.writer}` }
      })
      return [r.ms !== null, r.detail]
    },
  },
  'scrub-video': {
    async exercise(page) {
      await rangeAt(page, 'scene', 0.1)
      await wait(400) // the source set, the head loop running or handing over
      await rangeAt(page, 'scene', 0.5)
      await wait(100)
    },
    async works(page) {
      const scene = await sceneWorks(page, 'scene', 'video')
      const src = await page.evaluate(() => document.querySelector('video').getAttribute('src'))
      return [scene[0] && !!src, `${scene[1]}, src ${src}`]
    },
  },
  'frame-sequence': {
    async exercise(page) {
      await rangeAt(page, 'range', 0.5)
      await wait(300)
    },
    async works(page) {
      await rangeAt(page, 'range', 0.25)
      const r = await until(page, () => {
        const s = window.__t.handle('seq')?.stats()
        return { ok: !!s && s.state === 'ready' && s.frame === s.target && s.frame > 5, detail: `state ${s?.state}, frame ${s?.frame} of target ${s?.target}` }
      })
      return [r.ms !== null, r.detail]
    },
  },
  'loop-video': {
    async exercise(page) {
      await topAt(page, 'loop', 0.3)
      await until(page, () => ({ ok: !document.getElementById('loop').paused }), undefined, 3000)
    },
    async works(page) {
      await topAt(page, 'loop', 0.3)
      const r = await until(page, () => {
        const v = document.getElementById('loop')
        return { ok: !v.paused && v.currentTime > 0, detail: `paused ${v.paused}, t ${v.currentTime.toFixed(2)}, toggle "${v.parentElement.querySelector('[data-loop-toggle]')?.textContent}"` }
      })
      return [r.ms !== null, r.detail]
    },
  },
  parallax: {
    async exercise(page) {
      await topAt(page, 'l1', 0.6)
      await wait(50)
      await topAt(page, 'l1', 0.2)
      await wait(60) // the 0.5 s catch-up in flight
    },
    async works(page) {
      await topAt(page, 'l1', 0.8)
      await settle(page)
      const a = await page.evaluate(() => document.getElementById('l1').style.translate)
      await topAt(page, 'l1', 0.1)
      const r = await until(page, (a) => {
        const b = document.getElementById('l1').style.translate
        return { ok: !!a && !!b && a !== b, detail: `translate '${a}' → '${b}'` }
      }, a)
      return [r.ms !== null, r.detail]
    },
  },
  'colour-track': {
    async exercise(page) {
      await topAt(page, 'yellow', 0.5)
      await wait(80)
    },
    async works(page) {
      await topAt(page, 'yellow', 0.5)
      const r = await until(page, () => {
        const p = Number.parseFloat(document.body.style.getPropertyValue('--track-p'))
        return { ok: p > 0.3 && p < 0.7, detail: `--track-p ${p}, background ${getComputedStyle(document.body).backgroundColor}` }
      })
      return [r.ms !== null, r.detail]
    },
  },
  'draw-on-scroll': {
    async exercise(page) {
      await topAt(page, 'wave', 0.6)
      await wait(80)
    },
    async works(page) {
      await topAt(page, 'wave', 0.6)
      const r = await until(page, () => {
        const style = document.getElementById('wave-path').getAttribute('style') ?? ''
        return { ok: /stroke-dasharray/.test(style), detail: `path style '${style}'` }
      })
      return [r.ms !== null, r.detail]
    },
  },
  'marquee-velocity': {
    async exercise(page) {
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy({ top: 40, behavior: 'instant' }))
        await frames(page, 1)
      }
      await wait(50) // the speed's quickTo in flight
    },
    async works(page) {
      await scrollTop(page, 0)
      await page.mouse.move(5, 790)
      const offset = () => {
        const tr = getComputedStyle(document.getElementById('track')).transform
        return tr === 'none' ? 0 : new DOMMatrix(tr).m41
      }
      const a = await page.evaluate(offset)
      await wait(500)
      const b = await page.evaluate(offset)
      return [Math.abs(b - a) > 5, `offset ${a.toFixed(1)} → ${b.toFixed(1)} in 0.5 s`]
    },
  },
  'cursor-media': {
    async exercise(page) {
      const c = await centreOf(page, 'item-field')
      await page.mouse.move(c.x, c.y)
      await page.mouse.move(c.x + 8, c.y + 2)
      await wait(80) // the follow in flight
    },
    async works(page) {
      await page.mouse.move(1200, 780)
      const c = await centreOf(page, 'item-tide')
      await page.mouse.move(c.x, c.y)
      await page.mouse.move(c.x + 4, c.y)
      const r = await until(page, () => {
        const p = document.getElementById('preview')
        return { ok: p.getAttribute('data-cursor-media-state') === 'shown', detail: `state ${p.getAttribute('data-cursor-media-state')}, style '${p.getAttribute('style')}'` }
      })
      return [r.ms !== null, r.detail]
    },
  },
  'stepped-sections': {
    async exercise(page) {
      await scrollTop(page, 0)
      await page.mouse.move(640, 400)
      await page.mouse.wheel(0, 120)
      await wait(150) // a step in flight
    },
    async works(page) {
      await scrollTop(page, 0)
      await wait(300)
      await page.mouse.move(640, 400)
      await page.mouse.wheel(0, 120)
      const r = await until(page, () => {
        const want = Math.round(document.getElementById('s2').getBoundingClientRect().top + scrollY)
        return { ok: Math.abs(scrollY - want) <= 2, detail: `scrollY ${Math.round(scrollY)}, s2 at ${want}` }
      })
      return [r.ms !== null, r.detail]
    },
  },
  'scroll-well': {
    async exercise(page) {
      await topAt(page, 'well', 0.35)
      await wait(120) // pulling
    },
    async works(page) {
      await topAt(page, 'well', 0.35)
      // A 70vh well fits the viewport: it rests centred, its top at 15vh.
      const r = await until(page, () => {
        const top = document.getElementById('well').getBoundingClientRect().top
        return { ok: Math.abs(top - 0.15 * innerHeight) < 6, detail: `well top ${Math.round(top)} (rest ${Math.round(0.15 * innerHeight)})` }
      })
      return [r.ms !== null, r.detail]
    },
  },
  'flip-transition': {
    async exercise(page) {
      await scrollTop(page, 0)
      await page.click('#open')
      await wait(120) // mid-flight
    },
    async works(page) {
      await scrollTop(page, 0)
      await page.click('#open')
      const r = await until(page, () => {
        const styled = Array.from(document.querySelectorAll('#gallery li')).filter((li) => li.hasAttribute('style'))
        return { ok: window.__t.handle('flipDone') === true && !styled.length, detail: `landed ${window.__t.handle('flipDone')}, ${styled.length} styled` }
      })
      return [r.ms !== null, r.detail]
    },
  },
}

/** A scene answers the scroll: its progress is the range's rect progress, and it left the head. */
async function sceneWorks(page, id, key = 'scene') {
  await rangeAt(page, id, 0.5)
  const r = await until(
    page,
    ([id, key, fn]) => {
      const progress = new Function(`return (${fn})`)()(id)
      const h = window.__t.handle(key)
      const p = h?.progress()
      const state = document.getElementById(id).getAttribute('data-scene-state')
      return { ok: Math.abs(p - progress) < 0.01 && state !== 'head', detail: `progress ${p?.toFixed(3)} (rect ${progress.toFixed(3)}), mode ${state}` }
    },
    [id, key, rangeProgress.toString()],
  )
  return [r.ms !== null, r.detail]
}

// ── the run ─────────────────────────────────────────────────────────────

/** Leftovers with the block's kept media attributes taken out. Empty means clean. */
function problems(left, block) {
  const kept = KEPT[block] ?? []
  const strip = (line) => line.replace(/ ([\w-]+)="[^"]*"/g, (m, name) => (kept.includes(name) ? '' : m))
  const attrs = left.attrs
    .map((d) => d.split(' → '))
    .filter(([a, b]) => strip(a ?? '') !== strip(b ?? ''))
    .map((pair) => pair.join(' → '))
  const out = []
  if (left.listeners.length) out.push(`listeners: ${left.listeners.join(', ')}`)
  if (left.observers.length) out.push(`observing: ${left.observers.join(' | ')}`)
  if (left.intervals) out.push(`${left.intervals} interval(s)`)
  if (Object.keys(left.census).length) out.push(`live: ${JSON.stringify(left.census)}`)
  if (attrs.length) out.push(`attributes: ${attrs.join(' ; ')}`)
  return out
}
const sameCounts = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** One block, one browser, StrictMode off or on: [mode, ok, detail] for unmount, activity, remount. */
async function runBlock(browser, origin, block, strict) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message.split('\n')[0]))
  page.on('console', (msg) => msg.type() === 'error' && errors.push(`console: ${msg.text().split('\n')[0]}`))
  const c = CASES[block]
  const notes = { unmount: [], activity: [], remount: [] }
  const fail = (mode, what) => notes[mode].push(what)
  /** Tears down with `action`, reads what is live at once (nothing may still run) and once settled. */
  const teardown = async (mode, action, label) => {
    const now = await page.evaluate((a) => {
      window.__t[a]()
      return window.__t.leftovers().census
    }, action)
    if (Object.keys(now).length) fail(mode, `${label}, at once: live ${JSON.stringify(now)}`)
    await settle(page)
    for (const p of problems(await t(page, 'leftovers'), block)) fail(mode, `${label}: ${p}`)
  }
  try {
    await page.goto(`${origin}/?block=${block}${strict ? '&strict' : ''}`)
    await page.waitForFunction(() => window.__t?.ready())
    await settle(page)
    // Warm-up: GSAP keeps, for the page's life, the listeners its first trigger adds. Then count from here.
    await t(page, 'unmount')
    await settle(page)
    await t(page, 'arm')
    await t(page, 'mount')
    await settle(page, COUNT_MS)
    const fresh = await t(page, 'counts')

    // (a) unmount from a live state
    await c.exercise(page)
    await teardown('unmount', 'unmount', 'unmounted mid-state')

    // (c) remount: a fresh element
    await scrollTop(page, 0)
    await t(page, 'mount')
    await settle(page, COUNT_MS)
    const remounted = await t(page, 'counts')
    if (!sameCounts(remounted, fresh)) fail('remount', `counts ${JSON.stringify(remounted)} ≠ fresh ${JSON.stringify(fresh)}`)

    // (b) Activity: hidden at rest, shown (same counts), then hidden from a live state and shown (it works)
    await teardown('activity', 'hide', 'hidden at rest')
    await t(page, 'show')
    await settle(page, COUNT_MS)
    const shown = await t(page, 'counts')
    if (!sameCounts(shown, fresh)) fail('activity', `shown again: counts ${JSON.stringify(shown)} ≠ fresh ${JSON.stringify(fresh)}`)
    await c.exercise(page)
    await teardown('activity', 'hide', 'hidden mid-state')
    await t(page, 'show')
    await settle(page)
    const [worksShown, shownDetail] = await c.works(page)
    if (!worksShown) fail('activity', `shown again, it doesn't work: ${shownDetail}`)

    // (a) again, then (c): a remount works
    await teardown('unmount', 'unmount', 'unmounted after a show')
    await scrollTop(page, 0)
    await t(page, 'mount')
    await settle(page)
    const [worksRemounted, remountDetail] = await c.works(page)
    if (!worksRemounted) fail('remount', `it doesn't work: ${remountDetail}`)
    await teardown('remount', 'unmount', 'remounted, then unmounted')

    const pageErrors = [...errors, ...(await t(page, 'errors'))]
    if (pageErrors.length) fail('unmount', `page errors: ${pageErrors.join(' | ')}`)
    return Object.entries(notes).map(([mode, list]) => [
      mode,
      !list.length,
      list.length ? list.join(' · ').slice(0, 1400) : mode === 'activity' ? shownDetail : mode === 'remount' ? remountDetail : 'clean',
    ])
  } catch (err) {
    return [['unmount', false, `threw: ${err.message.split('\n')[0]}`]]
  } finally {
    await context.close()
  }
}

/** The order useGSAP tears down in, as the callback's cleanup sees it: [ok, what it saw]. */
async function measureOrder(browser, origin) {
  const context = await browser.newContext({ viewport: VIEWPORT })
  const page = await context.newPage()
  try {
    await page.goto(`${origin}/?block=order`)
    await page.waitForFunction(() => window.__t?.ready())
    await t(page, 'unmount')
    const seen = await page.evaluate(() => window.__t.handle('order'))
    return [seen.join(' → ') === ORDER, seen.join(' → ')]
  } finally {
    await context.close()
  }
}
/** Measured on GSAP 3.15.0 and @gsap/react 2.1.2; gsap.com documents no order. */
const ORDER = 'matchMedia cleanup → tween reverted → trigger killed → cleanup'

let server = null
let browserInUse = null
async function shutdown() {
  await browserInUse?.close().catch(() => {})
  await new Promise((resolve) => (server ? server.httpServer.close(resolve) : resolve()))
}
process.on('SIGINT', async () => {
  await shutdown()
  process.exit(130)
})

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (['ffmpeg', 'ffprobe'].some((bin) => spawnSync(bin, ['-version'], { stdio: 'ignore' }).error)) {
    console.log('SKIP  usegsap-teardown: ffmpeg/ffprobe not on PATH (the clip and the frames)')
    return 0
  }
  makeMedia()
  server = await serve()
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
  const table = new Map()
  let failures = 0
  for (const browserName of args.browsers) {
    const blocks = (args.blocks ?? BLOCKS).filter((b) => browserName === 'chromium' || EVERY_ENGINE.includes(b))
    if (!blocks.length) continue
    browserInUse = await BROWSERS[browserName].launch()
    const [inOrder, seen] = await measureOrder(browserInUse, origin)
    console.log(`${inOrder ? 'PASS' : 'FAIL'}  useGSAP order · ${browserName}  ${seen}${inOrder ? '' : ` (expected ${ORDER})`}`)
    if (!inOrder) failures++
    for (const block of blocks) {
      for (const strict of args.strict) {
        const results = await runBlock(browserInUse, origin, block, strict === 'on')
        for (const [mode, ok, detail] of results) {
          console.log(`${ok ? 'PASS' : 'FAIL'}  ${block} · ${mode}${strict === 'on' ? ' · strict' : ''} · ${browserName}  ${detail}`)
          if (!ok) failures++
          const key = `${block} · ${browserName}`
          const row = table.get(key) ?? {}
          const col = strict === 'on' ? 'strict' : mode
          row[col] = (row[col] ?? true) && ok
          if (strict === 'on') row.strict = row.strict && ok
          table.set(key, row)
        }
      }
    }
    await browserInUse.close()
    browserInUse = null
  }
  console.log('\nblock · browser                  unmount  activity remount  strict')
  for (const [key, row] of table) {
    const cell = (v) => (v === undefined ? '-' : v ? 'PASS' : 'FAIL').padEnd(9)
    console.log(`${key.padEnd(32)} ${cell(row.unmount)}${cell(row.activity)}${cell(row.remount)}${cell(row.strict)}`)
  }
  console.log(`\n${failures ? `${failures} FAIL` : 'all PASS'}`)
  return failures ? 1 : 0
}

const code = await main().catch((err) => {
  console.error(err)
  return 1
})
await shutdown()
process.exit(code)
