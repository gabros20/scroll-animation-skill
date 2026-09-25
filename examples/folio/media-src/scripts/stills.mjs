#!/usr/bin/env node
// The ten stills the Folio pages reference, plus the two plates the journal loops are rendered
// over. Three phases:
//
//   generate  prompts/<name>.txt → $WORK/stills/raw/<name>.jpg|png (+ <name>.json provenance),
//             through the generate-image skill's backends: `codex` (gen-image.sh, gpt-image-2)
//             or `grok` (Grok CLI, image_gen tool). Skips names that already have a raw file.
//   encode    raw → centre crop to the target ratio at native size → to the target size: Swin2SR
//             4× super-resolution (upscale.py) when the target is larger than the crop, a Lanczos
//             downscale otherwise → AVIF, searching the avifenc quality for the largest file
//             inside the art-direction budget.
//   plates    raw loop plates → $WORK/stills/plates/<name>.png for render/shots/*-loop.js. The rust
//             plate's frozen raindrops are painted out (the loop adds moving water instead).
//
// usage: node scripts/stills.mjs [generate|encode|plates|all] [--backend grok|codex] [--only a,b] [--force]

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { SRC, ensureDir, kb, paths, sh, shAsync } from './lib/work.mjs'

// dest is relative to public/media/; budget is the art direction's KB range.
export const STILLS = [
  { name: 'kiln-cover', dest: 'journal/kiln-cover.avif', size: [1600, 2000], budget: [180, 260], aspect: '3:4' },
  { name: 'kiln-detail', dest: 'journal/kiln-detail.avif', size: [1200, 1500], budget: [140, 200], aspect: '3:4' },
  { name: 'rust-cover', dest: 'journal/rust-cover.avif', size: [1600, 2000], budget: [180, 260], aspect: '3:4' },
  { name: 'rust-detail', dest: 'journal/rust-detail.avif', size: [1200, 1500], budget: [140, 200], aspect: '3:4' },
  { name: 'stoneware-vessel', dest: 'objects/stoneware-vessel.avif', size: [640, 800], budget: [90, 150], aspect: '3:4' },
  { name: 'corten-panel', dest: 'objects/corten-panel.avif', size: [640, 800], budget: [90, 150], aspect: '3:4' },
  { name: 'plywood-chair', dest: 'objects/plywood-chair.avif', size: [640, 800], budget: [90, 150], aspect: '3:4' },
  { name: 'forged-hinge', dest: 'objects/forged-hinge.avif', size: [640, 800], budget: [90, 150], aspect: '3:4' },
  { name: 'concrete-stair', dest: 'objects/concrete-stair.avif', size: [640, 800], budget: [90, 150], aspect: '3:4' },
  { name: 'glass-shade', dest: 'objects/glass-shade.avif', size: [640, 800], budget: [90, 150], aspect: '3:4' }
]

// Loop plates: generated, then animated by render/loop-*.js. Not shipped on their own.
export const PLATES = [
  { name: 'kiln-plate', aspect: '16:9' },
  // despeckle: % brighter than the local median counts as a raindrop; red below 45 is a bolt head
  { name: 'rust-plate', aspect: '16:9', despeckle: { threshold: 3, protectBelow: 45 } }
]

const RAW = join(paths.stills, 'raw')

const args = process.argv.slice(2)
const phase = args.find((a) => !a.startsWith('--')) ?? 'all'
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const backend = flag('backend') ?? 'grok'
const only = flag('only')?.split(',')
const force = args.includes('--force')
const pick = (list) => (only ? list.filter((s) => only.includes(s.name)) : list)

function rawFile(name) {
  for (const ext of ['png', 'jpg']) if (existsSync(join(RAW, `${name}.${ext}`))) return join(RAW, `${name}.${ext}`)
  return null
}

// ── generate ────────────────────────────────────────────────────────────

async function generateCodex({ name }) {
  const out = join(RAW, `${name}.png`)
  const script = join(homedir(), '.claude/skills/generate-image/scripts/gen-image.sh')
  // gen-image.sh falls back to "newest PNG in ~/.codex/generated_images", so never run two at once.
  sh(script, [join(SRC, 'prompts', `${name}.txt`), out])
  return { file: out, backend: 'codex', model: 'gpt-image-2 (Codex CLI $imagegen)' }
}

/** The Grok CLI is an agent: it calls its image_gen tool and saves under
 * ~/.grok/sessions/<cwd>/<session>/images/. One fresh cwd per still keeps them apart. */
async function generateGrok({ name, aspect }) {
  const cwd = ensureDir(join(paths.stills, 'grok', name))
  const prompt = readFileSync(join(SRC, 'prompts', `${name}.txt`), 'utf8').trim()
  const instruction = `Call the image_gen tool exactly once, with aspect_ratio "${aspect}" and exactly this prompt, then reply with the saved path only. Prompt: ${prompt}`
  const out = await shAsync('grok', ['--cwd', cwd, '--tools', 'image_gen', '--always-approve', '--output-format', 'json', '--max-turns', '4', '-p', instruction])
  const { sessionId } = JSON.parse(out)
  const sessions = join(homedir(), '.grok/sessions')
  for (const dir of readdirSync(sessions)) {
    const images = join(sessions, dir, sessionId, 'images')
    if (!existsSync(images)) continue
    const newest = readdirSync(images)
      .map((f) => join(images, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    if (!newest) break
    const file = join(RAW, `${name}.jpg`)
    writeFileSync(file, readFileSync(newest))
    return { file, backend: 'grok', model: 'Grok Imagine (Grok CLI image_gen tool)', sessionId }
  }
  throw new Error(`${name}: grok session ${sessionId} saved no image`)
}

async function generate(list) {
  ensureDir(RAW)
  const todo = list.filter((s) => force || !rawFile(s.name))
  // Grok: three at a time, each an agent round trip of ~30 s. Codex: one at a time (see above).
  const batch = backend === 'codex' ? 1 : 3
  for (let i = 0; i < todo.length; i += batch) {
    await Promise.all(
      todo.slice(i, i + batch).map(async (s) => {
        if (force) for (const ext of ['png', 'jpg']) rmSync(join(RAW, `${s.name}.${ext}`), { force: true })
        const meta = await (backend === 'codex' ? generateCodex(s) : generateGrok(s))
        const size = sh('magick', ['identify', '-format', '%wx%h', meta.file], { capture: true, quiet: true })
        writeFileSync(join(RAW, `${s.name}.json`), JSON.stringify({ ...meta, file: undefined, size, aspect: s.aspect, prompt: `prompts/${s.name}.txt`, date: new Date().toISOString() }, null, 2) + '\n')
        console.log(`generated ${s.name} ${size} via ${meta.backend}`)
      })
    )
  }
}

// ── encode ──────────────────────────────────────────────────────────────

/** Centre-crops raw to the target aspect at native size, then brings it to the target size:
 * Swin2SR when that means enlarging (upscale.py: 4× model pass, Lanczos to the exact size), a
 * Lanczos downscale otherwise. Writes the PNG intermediate the AVIF search reads from. */
function prepare(s, raw) {
  const [w, h] = s.size
  const dir = ensureDir(join(paths.stills, 'prepared'))
  const cropped = join(dir, `${s.name}-crop.png`)
  const out = join(dir, `${s.name}.png`)
  const [rw, rh] = sh('magick', ['identify', '-format', '%w %h', raw], { capture: true, quiet: true }).split(' ').map(Number)
  const target = w / h
  const [cw, ch] = rw / rh > target ? [Math.round(rh * target), rh] : [rw, Math.round(rw / target)]
  const crop = `${cw}x${ch}+${Math.round((rw - cw) / 2)}+${Math.round((rh - ch) / 2)}`
  sh('magick', [raw, '-colorspace', 'sRGB', '-crop', crop, '+repage', cropped], { quiet: true })
  if (w > cw) {
    if (!existsSync(out) || force) sh('python3', [join(SRC, 'upscale.py'), cropped, out, '--size', `${w}x${h}`])
    return { file: out, resize: `Swin2SR ${(w / cw).toFixed(2)}x` }
  }
  sh('magick', [cropped, '-filter', 'Lanczos', '-resize', `${w}x${h}!`, out], { quiet: true })
  return { file: out, resize: w === cw ? 'none' : `Lanczos ${(w / cw).toFixed(2)}x` }
}

/** Highest avifenc quality whose file fits under the budget's upper bound (binary search). */
function encodeAvif(src, dest, [, maxKb]) {
  let lo = 30
  let hi = 90
  let best = null
  while (lo <= hi) {
    const q = Math.floor((lo + hi) / 2)
    sh('avifenc', ['-q', String(q), '-s', '4', '-y', '444', '-d', '8', '--cicp', '1/13/1', '-j', 'all', src, dest], { quiet: true, capture: true })
    if (kb(dest) <= maxKb) {
      best = q
      lo = q + 1
    } else hi = q - 1
  }
  if (best === null) throw new Error(`${dest}: over ${maxKb} KB even at q30`)
  sh('avifenc', ['-q', String(best), '-s', '4', '-y', '444', '-d', '8', '--cicp', '1/13/1', '-j', 'all', src, dest], { quiet: true, capture: true })
  return best
}

function encode(list) {
  const rows = []
  for (const s of list) {
    const raw = rawFile(s.name)
    if (!raw) throw new Error(`${s.name}: no raw image; run the generate phase first`)
    const prepared = prepare(s, raw)
    ensureDir(dirname(join(paths.encoded, s.dest)))
    const dest = join(paths.encoded, s.dest)
    const q = encodeAvif(prepared.file, dest, s.budget)
    rows.push({ file: s.dest, size: `${s.size[0]}x${s.size[1]}`, kb: kb(dest), budget: `${s.budget[0]}-${s.budget[1]}`, quality: q, resize: prepared.resize })
  }
  console.table(rows)
  const total = rows.reduce((sum, r) => sum + r.kb, 0)
  console.log(`stills total: ${total} KB`)
}

// ── plates ──────────────────────────────────────────────────────────────

/** Loop plates as PNG at the loop size. The rust plate came back with rain frozen mid-fall (short
 * bright dashes); a still streak reads wrong once water moves around it, so small features
 * brighter than their 7×7 median are replaced by that median, feathered, except around the
 * near-black bolt heads, whose highlights are the same size and brightness as a raindrop. */
function plates(list) {
  const dir = ensureDir(join(paths.stills, 'plates'))
  for (const p of list) {
    const raw = rawFile(p.name)
    if (!raw) throw new Error(`${p.name}: no raw plate; run the generate phase first`)
    const out = join(dir, `${p.name}.png`)
    if (!p.despeckle) {
      sh('magick', [raw, '-colorspace', 'sRGB', '-resize', '1280x720!', out], { quiet: true })
      continue
    }
    const tmp = (n) => join(dir, `${p.name}-${n}.png`)
    sh('magick', [raw, '-colorspace', 'sRGB', '-resize', '1280x720!', tmp('src')], { quiet: true })
    sh('magick', [tmp('src'), '-statistic', 'Median', '7x7', tmp('median')], { quiet: true })
    const { threshold, protectBelow } = p.despeckle
    sh('magick', [tmp('src'), '-channel', 'R', '-separate', '+channel', '-threshold', `${((protectBelow / 255) * 100).toFixed(1)}%`, '-negate', '-morphology', 'Dilate', 'Disk:5', tmp('protect')], { quiet: true })
    sh('magick', [tmp('src'), tmp('median'), '-compose', 'Minus_Src', '-composite', '-colorspace', 'Gray', '-threshold', `${threshold}%`, '-morphology', 'Dilate', 'Disk:1.5', tmp('protect'), '-compose', 'Minus_Src', '-composite', '-blur', '0x0.8', tmp('mask')], { quiet: true })
    sh('magick', [tmp('median'), tmp('mask'), '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', tmp('patch')], { quiet: true })
    sh('magick', [tmp('src'), tmp('patch'), '-compose', 'over', '-composite', out], { quiet: true })
    for (const n of ['src', 'median', 'protect', 'mask', 'patch']) rmSync(tmp(n), { force: true })
  }
}

if (phase === 'generate' || phase === 'all') await generate(pick([...STILLS, ...PLATES]))
if (phase === 'encode' || phase === 'all') encode(pick(STILLS))
if (phase === 'plates' || phase === 'all') plates(pick(PLATES))
