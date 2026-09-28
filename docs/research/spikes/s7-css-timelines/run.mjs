// S7 — CSS scroll-driven animations (Chromium, WebKit, Firefox; `firefox-pref`
// is Firefox with layout.css.scroll-driven-animations.enabled switched on).
//
//   a  pages/ranges.html        view() + animation-range against the spec's maths
//   b  pages/scope.html         timeline-scope: a named view-timeline driving a sibling's descendant
//   c  pages/clip*.html         overflow hidden / clip between the subject and the page scroller
//   d  pages/sticky.html        a sticky stack: progress while the cards are stuck
//   e  pages/reduced.html       prefers-reduced-motion resets
//
// Every readout is taken at rest: scrollTo, three rAFs, then read each probe's
// timing progress (getComputedTiming) and its computed opacity and margin-left,
// which the fixtures animate linearly 0 -> 1 and 0 -> 40px, so each one reads
// back as progress. The expected progress comes from scroll-animations-1 §4
// (view progress timeline ranges) and each subject's layout box at scrollTop 0.
//
//   node run.mjs                          all parts, all engines
//   ENGINES=webkit PARTS=a,d node run.mjs
import { frames, newPage, r4, sleep, withBrowser, withServer, writeResult } from './harness.mjs'

const RUN = (process.env.ENGINES ?? 'chromium,webkit,firefox,firefox-pref').split(',')
const PARTS = (process.env.PARTS ?? 'a,b,c,d,e').split(',')
const STEP = Number(process.env.STEP ?? 25)

// ---- spec maths ------------------------------------------------------------
// Scroll offsets at which each named range starts and ends, for a subject whose
// border box starts at T (document px) and is h tall, in a scrollport H tall.
function namedRanges({ T, h }, H) {
  const containStart = Math.min(T, T + h - H)
  const containEnd = Math.max(T, T + h - H)
  return {
    cover: [T - H, T + h],
    contain: [containStart, containEnd],
    entry: [T - H, containStart],
    exit: [containEnd, T + h],
    'entry-crossing': [T - H, T + h - H],
    'exit-crossing': [T, T + h]
  }
}
/** 'entry 0% cover 40%' -> [startOffset, endOffset] in scroll px. */
function rangeOf(spec, g, H) {
  const [n1, p1, n2, p2] = spec.split(/\s+/)
  const r = namedRanges(g, H)
  const at = (n, p) => r[n][0] + ((r[n][1] - r[n][0]) * parseFloat(p)) / 100
  return [at(n1, p1), at(n2, p2)]
}
const clamp01 = (v) => Math.min(1, Math.max(0, v))

// progress readouts of one probe row
const readouts = (p, keys = ['timing', 'opacity', 'margin']) => {
  const out = {}
  if (keys.includes('timing')) out.timing = p.anims[0]?.progress ?? null
  if (keys.includes('opacity')) out.opacity = p.cs.opacity
  if (keys.includes('margin')) out.margin = p.cs.marginLeft / 40
  return out
}

/**
 * Compare measured progress with `expect(S, row)` over every sampled position.
 * expect returns { p, fill } where fill 'both' clamps and 'none' means the
 * static style (progress null, values at their finished static state) outside.
 */
function score(rows, id, expect, keys) {
  const errs = {}
  const worst = {}
  let n = 0
  const trace = []
  rows.forEach((row, i) => {
    const probe = row.probes.find((q) => q.id === id)
    if (!probe) return
    const e = expect(row.scrollTop, row, probe)
    if (e == null) return
    n++
    const got = readouts(probe, keys)
    for (const [k, v] of Object.entries(got)) {
      let want = e.p
      if (k === 'timing' && e.timingNull) want = null
      if (k !== 'timing' && e.static) want = 1
      if (k === 'margin' && e.marginP != null) want = e.marginP
      const err = want == null ? (v == null ? 0 : 1) : v == null ? 1 : Math.abs(v - want)
      if (!(k in errs) || err > errs[k]) {
        errs[k] = err
        worst[k] = { S: row.scrollTop, got: v == null ? null : r4(v), want: want == null ? null : r4(want) }
      }
    }
    if (i % 4 === 0) trace.push([row.scrollTop, ...Object.values(got).map((v) => (v == null ? null : r4(v))), r4(e.p)])
  })
  return { n, maxErr: Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, r4(v)])), worst, trace }
}

async function sweep(page, positions) {
  const rows = []
  for (const S of positions) {
    await page.evaluate((y) => window.scrollTo(0, y), S)
    await frames(page, 3)
    rows.push(await page.evaluate(() => window.__s7.read()))
  }
  return rows
}

const grid = (max, step = STEP) => {
  const out = []
  for (let s = 0; s <= max; s += step) out.push(s)
  if (out[out.length - 1] !== max) out.push(max)
  return out
}
const withEdges = (list, edges, max) =>
  [...new Set([...list, ...edges.flatMap((e) => [e - 1, e, e + 1].map(Math.round))])].filter((s) => s >= 0 && s <= max).sort((a, b) => a - b)

async function open(browser, base, path, ctx) {
  const page = await newPage(browser, ctx)
  await page.goto(`${base}/pages/${path}`)
  await page.waitForFunction(() => window.__s7)
  await frames(page, 3)
  return page
}

// ---- (a) view() ranges --------------------------------------------------------
const RANGE_OF = {
  entry: 'entry 0% entry 100%',
  cover50: 'cover 0% cover 50%',
  exit: 'exit 0% exit 100%',
  cover: 'cover 0% cover 100%',
  self: 'cover 0% cover 100%',
  multi: 'cover 0% cover 100%',
  dur1s: 'cover 0% cover 100%',
  snip1: 'entry 0% cover 40%',
  snip2: 'entry 0% cover 40%',
  snip3: 'entry 0% cover 40%'
}

async function partA(browser, base, engine) {
  const page = await open(browser, base, 'ranges.html')
  const support = await page.evaluate(() => window.__s7.support())
  const geo = await page.evaluate(() => window.__s7.geometry())
  const out = { support, H: geo.H, scrollMax: geo.scrollMax, subjects: {} }

  if (!support.viewTimeline) {
    // No scroll-driven animations: what does each box show, and what is attached?
    const snap = async () => {
      const r = await page.evaluate(() => window.__s7.read())
      return {
        documentTime: r4(r.t),
        probes: r.probes
          .filter((p) => p.id.startsWith('short-'))
          .map((p) => ({ id: p.id, opacity: r4(p.cs.opacity), marginLeft: p.cs.marginLeft, translate: p.cs.translate, anims: p.anims.map((a) => `${a.name} on ${a.timeline} ${a.playState} t=${a.currentTime == null ? null : r4(a.currentTime)}`) }))
      }
    }
    out.fallback = { atLoad: await snap() }
    await sleep(400)
    out.fallback.after400ms = await snap()
    await sleep(1100)
    out.fallback.after1500ms = await snap()
    const rows = await sweep(page, [0, 1000, 1400, 1600, 1800, 2400, 5000])
    out.fallback.constantOverScroll = Object.fromEntries(
      rows[0].probes.map((p) => [p.id, rows.every((r) => { const q = r.probes.find((x) => x.id === p.id); return q.cs.opacity === p.cs.opacity && q.cs.marginLeft === p.cs.marginLeft })])
    )
    await page.context().close()
    return out
  }

  const edges = []
  for (const [id, g] of Object.entries(geo.subjects)) {
    const kind = id.split('-')[1]
    if (RANGE_OF[kind]) edges.push(...rangeOf(RANGE_OF[kind], g, geo.H))
  }
  const rows = await sweep(page, withEdges(grid(geo.scrollMax), edges, geo.scrollMax))
  const clampedScroll = rows.filter((r, i) => i > 0 && r.scrollTop === rows[i - 1].scrollTop).length

  for (const id of Object.keys(geo.subjects)) {
    const [, kind] = id.split('-')
    const g = geo.subjects[id]
    const first = rows[0].probes.find((p) => p.id === id)
    const meta = first?.anims.map((a) => ({ name: a.name, timeline: a.timeline, source: a.source, rangeStart: a.rangeStart, rangeEnd: a.rangeEnd })) ?? []
    let s
    if (kind === 'order') {
      s = score(rows, id, () => ({ p: 1 }), ['opacity', 'margin'])
    } else if (kind === 'multi') {
      const r = rangeOf(RANGE_OF.multi, g, geo.H)
      s = score(rows, id, (S) => ({ p: clamp01((S - r[0]) / (r[1] - r[0])), marginP: S / geo.scrollMax }), ['opacity', 'margin'])
    } else if (kind === 'snip1' || kind === 'snip2' || kind === 'snip3') {
      const r = rangeOf(RANGE_OF[kind], g, geo.H)
      const fillNone = kind === 'snip2'
      s = score(
        rows,
        id,
        (S) => {
          const raw = (S - r[0]) / (r[1] - r[0])
          // exactly at the range end, fill none: skipped (engines disagree on inclusivity, reported separately)
          if (fillNone && raw === 1) return null
          if (fillNone && (raw < 0 || raw > 1)) return { p: 1, timingNull: true }
          return { p: clamp01(raw) }
        },
        ['timing', 'opacity']
      )
      const endRow = rows.find((row) => row.scrollTop === Math.round(r[1]))
      const endProbe = endRow?.probes.find((p) => p.id === id)
      s.atRangeEnd = endProbe && { S: endRow.scrollTop, timing: endProbe.anims[0]?.progress ?? null, opacity: endProbe.cs.opacity }
    } else {
      const r = rangeOf(RANGE_OF[kind], g, geo.H)
      s = score(rows, id, (S) => ({ p: clamp01((S - r[0]) / (r[1] - r[0])) }))
      s.range = r.map(r4)
      s.rangeLength = r4(r[1] - r[0])
      s.maxErrPx = r4(Math.max(...Object.values(s.maxErr)) * (r[1] - r[0]))
    }
    out.subjects[id] = { T: g.T, h: g.h, anims: meta, ...s }
  }
  out.clampedScroll = clampedScroll
  await page.context().close()
  return out
}

// ---- (b) timeline-scope ---------------------------------------------------------
async function partB(browser, base) {
  const page = await open(browser, base, 'scope.html')
  const support = await page.evaluate(() => window.__s7.support())
  const geo = await page.evaluate(() => window.__s7.geometry())
  const rows = await sweep(page, grid(geo.scrollMax))
  const out = { support }
  const other = { 'dup-a': 'subj-dup-b', 'dup-b': 'subj-dup-a', 'dups-a': 'subj-dups-b', 'dups-b': 'subj-dups-a' }
  for (const id of ['scoped', 'unscoped', 'desc', 'dup-a', 'dup-b', 'dups-a', 'dups-b']) {
    const g = geo.subjects[rows[0].probes.find((p) => p.id === id).subject]
    const r = rangeOf('cover 0% cover 100%', g, geo.H)
    const tracks = score(rows, id, (S) => ({ p: clamp01((S - r[0]) / (r[1] - r[0])) }))
    const asStatic = score(rows, id, () => ({ p: 1, static: true, timingNull: true }), ['opacity', 'margin'])
    const first = rows.find((row) => row.scrollTop > r[0] && row.scrollTop < r[1])?.probes.find((p) => p.id === id)
    out[id] = {
      anims: first?.anims.map((a) => ({ name: a.name, timeline: a.timeline, subject: a.subject, source: a.source, playState: a.playState, progress: a.progress })),
      computedTimeline: first?.cs.animationTimeline,
      tracksSubject: { maxErr: tracks.maxErr, worst: tracks.worst, n: tracks.n },
      staysStatic: { maxErr: asStatic.maxErr }
    }
    if (other[id]) {
      const go = geo.subjects[other[id]]
      const ro = rangeOf('cover 0% cover 100%', go, geo.H)
      out[id].tracksOtherStage = { maxErr: score(rows, id, (S) => ({ p: clamp01((S - ro[0]) / (ro[1] - ro[0])) })).maxErr }
    }
  }
  await page.context().close()
  return out
}

// ---- (c) ancestors that clip ---------------------------------------------------
async function partC(browser, base) {
  const out = {}
  for (const path of ['clip.html', 'clip-body.html', 'clip-htmlbody.html']) {
    const page = await open(browser, base, path)
    const support = await page.evaluate(() => window.__s7.support())
    out.support ??= support
    const geo = await page.evaluate(() => window.__s7.geometry())
    const rows = await sweep(page, grid(geo.scrollMax))
    for (const probe of rows[0].probes) {
      const id = probe.id
      const g = geo.subjects[probe.subject]
      const r = rangeOf('cover 0% cover 100%', g, geo.H)
      const tracks = score(rows, id, (S) => ({ p: clamp01((S - r[0]) / (r[1] - r[0])) }))
      const inRange = rows.filter((row) => row.scrollTop > r[0] && row.scrollTop < r[1]).map((row) => row.probes.find((p) => p.id === id))
      const opac = inRange.map((p) => p.cs.opacity)
      const mid = inRange[Math.floor(inRange.length / 2)]
      out[id] = {
        page: path,
        timeline: mid?.anims.map((a) => `${a.timeline} source=${a.source}`),
        pageTracking: { maxErr: tracks.maxErr, n: tracks.n },
        opacityAcrossPageRange: { min: r4(Math.min(...opac)), max: r4(Math.max(...opac)) },
        timingAcrossPageRange: [...new Set(inRange.map((p) => (p.anims[0]?.progress == null ? null : r4(p.anims[0].progress))))].slice(0, 4)
      }
    }
    await page.context().close()
  }
  return out
}

// ---- (d) sticky stack ------------------------------------------------------------
async function partD(browser, base) {
  const page = await open(browser, base, 'sticky.html')
  const support = await page.evaluate(() => window.__s7.support())
  const geo = await page.evaluate(() => window.__s7.geometry())
  const rows = await sweep(page, grid(geo.scrollMax))
  const H = geo.H
  const spec = {
    'c1-own': 'cover 0% cover 100%',
    'c2-own': 'cover 0% cover 100%',
    'c3-own': 'cover 0% cover 100%',
    'c1-inner': 'cover 0% cover 100%',
    'c1-next': 'entry 0% entry 100%',
    'c2-next': 'entry 0% entry 100%'
  }
  const subjectProbe = { 'c1-next': 'c2-own', 'c2-next': 'c3-own' }
  const out = { support, stuck: {} }
  // observed stuck intervals (card top pinned at 0 while the page scrolls past its slot)
  for (const id of ['c1-own', 'c2-own', 'c3-own']) {
    const T = geo.subjects[id].T
    const stuck = rows.filter((row) => row.scrollTop >= T && Math.abs(row.probes.find((p) => p.id === id).top) < 0.5).map((row) => row.scrollTop)
    out.stuck[id] = stuck.length ? [Math.min(...stuck), Math.max(...stuck)] : null
  }
  const topOf = (row, subjId) => row.probes.find((p) => p.id === subjId).top
  // Model C: range ends found where the box, sticky offset included, actually
  // crosses the scrollport edges; progress linear in scroll between them.
  const firstAtOrBelow = (subjId, f) => {
    for (let i = 1; i < rows.length; i++) {
      const a = f(topOf(rows[i - 1], subjId))
      const b = f(topOf(rows[i], subjId))
      if (a > 0 && b <= 0) return rows[i - 1].scrollTop + ((rows[i].scrollTop - rows[i - 1].scrollTop) * a) / (a - b)
    }
    return null
  }
  const lastAtOrAbove = (subjId, f) => {
    for (let i = rows.length - 2; i >= 0; i--) {
      const a = f(topOf(rows[i], subjId))
      const b = f(topOf(rows[i + 1], subjId))
      if (a >= 0 && b < 0) return rows[i].scrollTop + ((rows[i + 1].scrollTop - rows[i].scrollTop) * a) / (a - b)
    }
    return null
  }
  function crossingRanges(subjId, h) {
    const coverStart = firstAtOrBelow(subjId, (top) => top - H)
    const coverEnd = firstAtOrBelow(subjId, (top) => top + h)
    const containStart = h >= H ? firstAtOrBelow(subjId, (top) => top) : firstAtOrBelow(subjId, (top) => top + h - H)
    const containEnd = h >= H ? lastAtOrAbove(subjId, (top) => top + h - H) : lastAtOrAbove(subjId, (top) => top)
    return { cover: [coverStart, coverEnd], contain: [containStart, containEnd], entry: [coverStart, containStart], exit: [containEnd, coverEnd] }
  }
  const lin = (S, [a, b]) => (b - a === 0 ? null : { p: clamp01((S - a) / (b - a)) })
  const scoreAnim = (id, k, expect) => {
    const errs = []
    let worst = null
    for (const row of rows) {
      const probe = row.probes.find((p) => p.id === id)
      const e = expect(row.scrollTop, row)
      const got = probe.anims[k]?.progress
      if (e == null || got == null) continue
      const err = Math.abs(got - e.p)
      errs.push(err)
      if (!worst || err > worst.err) worst = { S: row.scrollTop, got: r4(got), want: r4(e.p), err }
    }
    // n 0: the model's range has zero length (nothing to compare), reported as null
    return { n: errs.length, maxErr: errs.length ? r4(Math.max(...errs)) : null, worst: worst && { S: worst.S, got: worst.got, want: worst.want } }
  }
  const checks = [
    ...Object.entries(spec).map(([id, rs]) => ({ id, k: 0, rs })),
    { id: 'c1-own', k: 1, rs: 'contain 0% contain 100%' },
    { id: 'c1-own', k: 2, rs: 'exit 0% exit 100%' },
    { id: 'c2-own', k: 1, rs: 'contain 0% contain 100%' },
    { id: 'c2-own', k: 2, rs: 'exit 0% exit 100%' }
  ]
  out.checks = []
  for (const { id, k, rs } of checks) {
    const subjId = subjectProbe[id] ?? id
    const g = geo.subjects[subjId]
    const name = rs.split(' ')[0]
    // Model A: the layout position with no sticky offset (the box at scrollTop 0).
    const rA = rangeOf(rs, g, H)
    // Model B: where the box is in this frame, sticky offset included.
    const B = (S, row) => lin(S, rangeOf(rs, { T: S + topOf(row, subjId), h: g.h }, H))
    const rC = crossingRanges(subjId, g.h)[name]
    out.checks.push({
      probe: id,
      anim: k,
      range: rs,
      subject: subjId,
      staticRange: rA.map(r4),
      crossingRange: rC.map(r4),
      A_static: scoreAnim(id, k, (S) => lin(S, rA)),
      B_stuckPosition: scoreAnim(id, k, B),
      C_crossings: scoreAnim(id, k, (S) => lin(S, rC))
    })
  }
  await page.context().close()
  return out
}

// ---- (e) reduced motion ------------------------------------------------------------
async function partE(browser, base) {
  const out = {}
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await open(browser, base, 'reduced.html', { reducedMotion })
    const geo = await page.evaluate(() => window.__s7.geometry())
    const g = geo.subjects.control
    const positions = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(g.T - geo.H + f * (geo.H + g.h)))
    const rows = await sweep(page, positions)
    const res = {}
    for (const p0 of rows[0].probes) {
      const series = rows.map((row) => row.probes.find((p) => p.id === p0.id))
      const vals = series.map((p) => [r4(p.cs.opacity), r4(p.cs.marginLeft), p.cs.scale])
      const atStatic = series.every((p) => p.cs.opacity === 1 && p.cs.marginLeft === 40 && (p.cs.scale === 'none' || p.cs.scale === '1'))
      res[p0.id] = {
        animsAttached: Math.max(...series.map((p) => p.anims.length)),
        anim: series[2].anims.map((a) => `${a.name} on ${a.timeline} ${a.playState} progress=${a.progress == null ? null : r4(a.progress)}`),
        computed: { name: series[2].cs.animationName, timeline: series[2].cs.animationTimeline, range: series[2].cs.animationRange, duration: series[2].cs.animationDuration },
        values: vals,
        varies: new Set(vals.map((v) => v.join('|'))).size > 1,
        staticAtEveryOffset: atStatic
      }
    }
    out[reducedMotion] = res
    await page.context().close()
  }
  return out
}

const PART_FNS = { a: partA, b: partB, c: partC, d: partD, e: partE }
const out = { spike: 'S7', date: new Date().toISOString(), step: STEP, engines: {} }
await withServer(async (base) => {
  for (const engine of RUN) {
    await withBrowser(engine, async (browser) => {
      const res = (out.engines[engine] = { version: browser.version() })
      for (const part of PARTS) {
        const t0 = Date.now()
        res[part] = await PART_FNS[part](browser, base, engine)
        console.error(`[s7] ${engine} ${part} ${Date.now() - t0} ms`)
      }
    })
  }
})
const file = writeResult(process.env.OUT ?? 's7', out)

// Compact summary: the numbers the write-up quotes.
const maxOf = (o) => (o ? r4(Math.max(...Object.values(o))) : null)
const summary = {}
for (const [engine, e] of Object.entries(out.engines)) {
  const s = (summary[engine] = { version: e.version })
  if (e.a) {
    s.a = e.a.fallback
      ? {
          supports: e.a.support.viewTimeline,
          atLoad: Object.fromEntries(e.a.fallback.atLoad.probes.map((p) => [p.id, `${p.opacity} ${p.anims.join(',') || 'no animation'}`])),
          snip3After400ms: e.a.fallback.after400ms.probes.find((p) => p.id === 'short-snip3')?.opacity,
          constantOverScroll: Object.values(e.a.fallback.constantOverScroll).every(Boolean)
        }
      : Object.fromEntries(Object.entries(e.a.subjects).map(([id, v]) => [id, `max ${maxOf(v.maxErr)}${v.maxErrPx != null ? ` (${v.maxErrPx}px)` : ''} ${v.anims.map((a) => a.timeline).join('+')}`]))
  }
  if (e.b) s.b = Object.fromEntries(Object.entries(e.b).filter(([k]) => k !== 'support').map(([id, v]) => [id, `tracks own subject: max ${maxOf(v.tracksSubject.maxErr)}${v.tracksOtherStage ? `, other stage: max ${maxOf(v.tracksOtherStage.maxErr)}` : ''}; ${v.anims?.map((a) => `${a.timeline} ${a.playState}`).join(',') || 'no animation'}`]))
  if (e.c) s.c = Object.fromEntries(Object.entries(e.c).filter(([k]) => k !== 'support').map(([id, v]) => [id, `page max ${maxOf(v.pageTracking.maxErr)}; ${v.timeline?.join(',') || 'no animation'}; opacity ${v.opacityAcrossPageRange.min}..${v.opacityAcrossPageRange.max}`]))
  if (e.d) {
    s.d = { stuck: e.d.stuck }
    for (const c of e.d.checks ?? []) s.d[`${c.probe}#${c.anim} ${c.range}`] = `A static ${c.A_static.maxErr} | B stuck-position ${c.B_stuckPosition.maxErr} | C crossings ${JSON.stringify(c.crossingRange)} ${c.C_crossings.maxErr}`
  }
  if (e.e) s.e = Object.fromEntries(Object.entries(e.e.reduce).map(([id, v]) => [id, `${v.animsAttached} attached, ${v.varies ? 'still scrubs' : 'constant'}, ${v.staticAtEveryOffset ? 'static style' : 'not static'}; timeline ${v.computed.timeline}`]))
}
console.log(JSON.stringify({ spike: 'S7', raw: file, summary }, null, 1))
