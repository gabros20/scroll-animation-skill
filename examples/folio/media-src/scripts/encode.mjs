#!/usr/bin/env node
// Rendered frames → masters → the delivery files, through this repo's own CLI
// (skills/scroll-animation/bin/scroll-animation media …), into $WORK/encoded/ laid out exactly as
// examples/folio/public/media/.
//
//   masters   PNG frames → lossless H.264 4:4:4 (qp 0), BT.709 matrix, limited range, tagged, so
//             every later step (and the browser) converts colour the same way
//   scrub     media scrub → all-intra hero/scrub-camera-1920.mp4 + the 1080-wide variant
//   sequence  media sequence → blocks/camera-sequence/ (120 WebP frames + manifest, mobile/ set)
//   loops     media loop → journal/{kiln,rust}-loop.mp4
//   posters   frame 0 of each ENCODED file (references/video.md §9) → avifenc → the .avif the pages
//             reference; lab/camera-poster.avif is the render itself
//   model     lab/antique-camera.glb from scripts/model.mjs
//
// Then media probe on every video, sizes against the art-direction budgets, and the loop seams
// checked on the encoded output. Writes $WORK/encoded/report.json.
//
// usage: node scripts/encode.mjs [--scrub-crf 18] [--loop-crf 14] [--sequence-quality 86]
//
// Why not the CLI's defaults: the flat paper costs almost nothing, so CRF 23 lands every file far
// under its budget while softening the leather grain (41 dB on the camera body vs 44.5 at CRF 18)
// and skip-blocking the loops' faint heat haze and rain. The budgets buy quality back.

import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CLI, ensureDir, kb, mb, paths, sh } from './lib/work.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const scrubCrf = opt('scrub-crf', '18')
const loopCrf = opt('loop-crf', '14')
const sequenceQuality = opt('sequence-quality', '86')

const OUT = paths.encoded
const out = (rel) => join(OUT, rel)
const media = (...rest) => sh('node', [CLI, 'media', ...rest])

// Art-direction budgets (KB). Videos: [min, max]; the max is the hard line.
export const BUDGETS = {
  'hero/scrub-camera-1920.mp4': [8 * 1024, 14 * 1024],
  'hero/scrub-camera-1080.mp4': [3 * 1024, 6 * 1024],
  'hero/scrub-camera-poster.avif': [150, 250],
  'blocks/camera-sequence/': [2.5 * 1024, 4 * 1024],
  'journal/kiln-loop.mp4': [1.5 * 1024, 3 * 1024],
  'journal/rust-loop.mp4': [1.5 * 1024, 3 * 1024],
  'journal/kiln-loop-poster.avif': [100, 180],
  'journal/rust-loop-poster.avif': [100, 180],
  'lab/antique-camera.glb': [0, 3 * 1024],
  'lab/camera-poster.avif': [150, 250]
}

// ── masters ─────────────────────────────────────────────────────────────

function master(shot) {
  const frames = join(paths.frames, shot)
  if (!existsSync(join(frames, '0001.png'))) throw new Error(`no frames for ${shot}; run scripts/render.mjs ${shot}`)
  const dest = join(ensureDir(paths.masters), `${shot}.mp4`)
  // setparams tags the frames themselves, so the tags survive into every encode made from them.
  sh('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', '30', '-i', join(frames, '%04d.png'), '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv444p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv', '-c:v', 'libx264', '-preset', 'slow', '-qp', '0', '-an', dest])
  return dest
}

// ── AVIF posters ────────────────────────────────────────────────────────

/** Highest avifenc quality whose file fits under maxKb (binary search), 4:4:4, BT.709. */
function avif(src, dest, maxKb) {
  ensureDir(dirname(dest))
  const enc = (q) => sh('avifenc', ['-q', String(q), '-s', '4', '-y', '444', '-d', '8', '--cicp', '1/13/1', '-j', 'all', src, dest], { quiet: true, capture: true })
  let lo = 30
  let hi = 90
  let best = null
  while (lo <= hi) {
    const q = Math.floor((lo + hi) / 2)
    enc(q)
    if (kb(dest) <= maxKb) {
      best = q
      lo = q + 1
    } else hi = q - 1
  }
  if (best === null) throw new Error(`${dest}: over ${maxKb} KB even at q30`)
  enc(best)
  return best
}

/** Frame 0 of an encoded video → PNG → AVIF. Not `media poster`: its yuv420p → RGB step is
 * ffmpeg's fast default, which lands 2–3 levels dark (paper 243,239,230 instead of the
 * 245,241,233 a browser shows), and the poster would visibly step when the video takes over.
 * Here the conversion is explicit: BT.709, limited range in, accurate rounding. */
function videoPoster(video, rel) {
  const png = join(paths.masters, `${rel.replace(/[/.]/g, '_')}.png`)
  sh('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-frames:v', '1', '-vf', 'scale=flags=accurate_rnd+full_chroma_int:in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24', png])
  const q = avif(png, out(rel), BUDGETS[rel][1])
  rmSync(png, { force: true })
  return q
}

// ── seams ───────────────────────────────────────────────────────────────

/** PSNR of consecutive pairs across a decoded clip, and of the wrap (last → first). A loop is
 * seamless when the wrap scores like any other step rather than like a cut. */
function seam(video) {
  const tmp = ensureDir(join(paths.masters, 'seam'))
  for (const f of readdirSync(tmp)) rmSync(join(tmp, f))
  sh('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-fps_mode', 'passthrough', join(tmp, '%04d.png')], { quiet: true })
  const frames = readdirSync(tmp).filter((f) => f.endsWith('.png')).sort()
  const steps = []
  const stride = Math.max(1, Math.floor(frames.length / 30))
  for (let i = 0; i + 1 < frames.length; i += stride) steps.push(psnr(join(tmp, frames[i]), join(tmp, frames[i + 1])))
  const wrap = psnr(join(tmp, frames[frames.length - 1]), join(tmp, frames[0]))
  for (const f of readdirSync(tmp)) rmSync(join(tmp, f))
  const min = Math.min(...steps)
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length
  return { frames: frames.length, wrapPsnr: +wrap.toFixed(2), stepPsnrMean: +mean.toFixed(2), stepPsnrMin: +min.toFixed(2), seamless: wrap >= min - 0.5 }
}

/** ffmpeg's psnr filter, read back from its stats file (the summary only goes to stderr). */
function psnr(a, b) {
  const log = join(paths.masters, 'psnr.log')
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', a, '-i', b, '-lavfi', `psnr=stats_file=${log}`, '-f', 'null', '-'], { quiet: true, capture: true })
  const value = /psnr_avg:(\S+)/.exec(readFileSync(log, 'utf8'))?.[1]
  return value === 'inf' ? 99 : Number(value)
}

/** `media probe`, as printed by the CLI, with the colour codes stripped. */
function probe(rel) {
  const text = sh('node', [CLI, 'media', 'probe', out(rel)], { quiet: true, capture: true }).replace(/\x1b\[[0-9;]*m/g, '')
  const line = (key) => text.split('\n').find((l) => l.trim().startsWith(key))?.trim().slice(key.length).trim()
  return { codec: line('codec'), resolution: line('resolution'), keyframes: line('keyframes'), faststart: line('faststart'), audio: line('audio'), verdicts: line('verdicts') }
}

// ── run ─────────────────────────────────────────────────────────────────

ensureDir(OUT)
const report = { settings: { scrubCrf, loopCrf, sequenceQuality }, files: [], probes: {}, seams: {} }

// Scrub: all-intra 1920 + 1080-wide, from the orbit master.
const orbit = master('orbit')
media('scrub', orbit, '--out', out('hero/scrub-camera-1920.mp4'), '--crf', scrubCrf, '--mobile', '1080')
renameSync(out('hero/scrub-camera-1920-mobile.mp4'), out('hero/scrub-camera-1080.mp4'))
for (const f of readdirSync(out('hero'))) if (f.endsWith('-poster.webp') || f.endsWith('-poster.png')) rmSync(out(join('hero', f))) // the pages use AVIF
report.posterQuality = { 'hero/scrub-camera-poster.avif': videoPoster(out('hero/scrub-camera-1920.mp4'), 'hero/scrub-camera-poster.avif') }

// Sequence: 120 frames, 1600 wide + a 900-wide mobile set, from the same master.
rmSync(out('blocks/camera-sequence'), { recursive: true, force: true })
media('sequence', orbit, '--out', out('blocks/camera-sequence'), '--frames', '120', '--width', '1600', '--mobile-width', '900', '--quality', sequenceQuality)

// Loops.
for (const name of ['kiln-loop', 'rust-loop']) {
  const m = master(name)
  media('loop', m, '--out', out(`journal/${name}.mp4`), '--crf', loopCrf)
  for (const f of readdirSync(out('journal'))) if (f.startsWith(`${name}-poster.`) && !f.endsWith('.avif')) rmSync(out(join('journal', f)))
  report.posterQuality[`journal/${name}-poster.avif`] = videoPoster(out(`journal/${name}.mp4`), `journal/${name}-poster.avif`)
  report.seams[`journal/${name}.mp4`] = seam(out(`journal/${name}.mp4`))
}

// Lab: the compressed model and its rendered poster.
ensureDir(out('lab'))
copyFileSync(join(paths.model, 'antique-camera.glb'), out('lab/antique-camera.glb'))
report.posterQuality['lab/camera-poster.avif'] = avif(join(paths.frames, 'lab-poster', '0001.png'), out('lab/camera-poster.avif'), BUDGETS['lab/camera-poster.avif'][1])

// The scrub clip also loops as a whole (a full turn): check its wrap too.
report.seams['hero/scrub-camera-1920.mp4'] = seam(out('hero/scrub-camera-1920.mp4'))

// Probe and size everything.
for (const rel of ['hero/scrub-camera-1920.mp4', 'hero/scrub-camera-1080.mp4', 'journal/kiln-loop.mp4', 'journal/rust-loop.mp4']) report.probes[rel] = probe(rel)
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
for (const file of walk(OUT).filter((f) => !f.endsWith('report.json')).sort()) {
  report.files.push({ file: file.slice(OUT.length + 1), bytes: statSync(file).size })
}
const seqBytes = report.files.filter((f) => f.file.startsWith('blocks/camera-sequence/') && !f.file.includes('/mobile/')).reduce((s, f) => s + f.bytes, 0)
const seqMobile = report.files.filter((f) => f.file.includes('camera-sequence/mobile/')).reduce((s, f) => s + f.bytes, 0)
report.sequence = { desktopBytes: seqBytes, mobileBytes: seqMobile }
writeFileSync(out('report.json'), JSON.stringify(report, null, 2) + '\n')

const rows = Object.entries(BUDGETS).map(([rel, [lo, hi]]) => {
  const bytes = rel.endsWith('/') ? seqBytes : statSync(out(rel)).size
  const k = Math.round(bytes / 1024)
  return { file: rel, KB: k, budgetKB: `${lo}-${hi}`, verdict: k > hi ? 'OVER' : k < lo ? 'under' : 'in range' }
})
console.table(rows)
console.log(`sequence mobile set: ${mb(seqMobile)} MB`)
for (const [rel, p] of Object.entries(report.probes)) console.log(`${rel}: ${p.verdicts} | ${p.codec} | ${p.keyframes}`)
for (const [rel, s] of Object.entries(report.seams)) console.log(`${rel} seam: ${JSON.stringify(s)}`)
