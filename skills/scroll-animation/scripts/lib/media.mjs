// media.mjs — the ffmpeg/ffprobe recipes behind `scroll-animation media …`. Pure functions: no
// argv parsing, no console output. cli/commands/media.mjs is the thin layer that calls these and
// prints. Every recipe shells out to ffmpeg/ffprobe on PATH — never a bundled binary, no npm
// dependency.

import { spawnSync } from 'node:child_process'
import { openSync, closeSync, readSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'

/** Throws a plain Error (the CLI layer turns it into a CliError, exit 1) naming whichever of
 * ffmpeg/ffprobe is missing. Call once before any recipe below. */
export function checkFfmpeg() {
  const missing = ['ffmpeg', 'ffprobe'].filter((bin) => spawnSync(bin, ['-version'], { stdio: 'ignore' }).error)
  if (missing.length) {
    throw new Error(`${missing.join(' and ')} not found on PATH. Media commands need ffmpeg and ffprobe installed ` + `(macOS: \`brew install ffmpeg\`; else see https://ffmpeg.org/download.html).`)
  }
}

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 })
  if (r.error) throw new Error(`${bin} failed to run: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`${bin} exited ${r.status}: ${(r.stderr || '').trim().slice(-2000)}`)
  return r.stdout
}
const ffprobe = (args) => run('ffprobe', ['-v', 'error', ...args])
const ffmpeg = (args) => run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args])

// ── still-image format: webp, with a png fallback ──────────────────────
//
// libwebp is an optional ffmpeg encoder (left out of some distro/CI builds — Debian's packaged
// ffmpeg and some minimal images among them), unlike mjpeg and png, which ship in every build.
// Detected once per process and cached; the fallback is reported once, not once per frame.

let webpSupported
function hasWebpEncoder() {
  if (webpSupported === undefined) webpSupported = run('ffmpeg', ['-hide_banner', '-encoders']).includes('libwebp')
  return webpSupported
}
let warnedWebpFallback = false
function warnWebpFallback() {
  if (warnedWebpFallback) return
  warnedWebpFallback = true
  process.stderr.write('media: this ffmpeg build has no libwebp encoder — writing PNG stills instead.\n')
}
/** webp if this ffmpeg build has it, else png — decided once, used for every frame of one call
 * (sequence's frames all share one format; mixing would make the manifest a lie). */
function stillFormat() {
  if (hasWebpEncoder()) return { ext: 'webp', codec: 'libwebp' }
  warnWebpFallback()
  return { ext: 'png', codec: 'png' }
}
/** The codec (and, if libwebp is unavailable, the corrected path) for one explicit `out` path:
 * .jpg/.jpeg → mjpeg, .png → png, anything else (including .webp) → webp when available, else png
 * — with the path's extension swapped to match what actually got written. */
function stillOut(desiredPath) {
  const ext = extname(desiredPath).slice(1).toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return { path: desiredPath, codec: 'mjpeg' }
  if (ext === 'png') return { path: desiredPath, codec: 'png' }
  if (hasWebpEncoder()) return { path: desiredPath, codec: 'libwebp' }
  warnWebpFallback()
  return { path: desiredPath.replace(/\.[^./]+$/, '.png'), codec: 'png' }
}

// ── path helpers ────────────────────────────────────────────────────────

function splitExt(p) {
  const ext = extname(p)
  return [p.slice(0, p.length - ext.length), ext]
}
/** input.mp4, 'scrub' → input-scrub.mp4 (next to the input, same container). */
function defaultOut(input, tag) {
  const [base] = splitExt(input)
  return `${base}-${tag}${extname(input) || '.mp4'}`
}
function withSuffix(p, suffix) {
  const [base, ext] = splitExt(p)
  return `${base}${suffix}${ext}`
}
export function posterFor(p) {
  const [base] = splitExt(p)
  return `${base}-poster.webp`
}
function ensureDirFor(file) {
  mkdirSync(dirname(file), { recursive: true })
}

// ── probing ─────────────────────────────────────────────────────────────

function ffprobeFormat(path) {
  return JSON.parse(ffprobe(['-print_format', 'json', '-show_format', '-show_streams', path]))
}

/** Per-frame pict_type in decode order (the technique references/video.md §1 itself points at):
 * total frame count, keyframe count, and the max span in frames between consecutive keyframes
 * (an all-intra file spans 1; a normal GOP-N file spans ~N). */
function keyframeStats(path) {
  const out = ffprobe(['-select_streams', 'v:0', '-show_entries', 'frame=pict_type', '-of', 'csv=p=0', path])
  // A frame carrying side data (typically the first keyframe) gets an extra trailing comma from
  // csv=p=0 on some ffprobe builds ("I," instead of "I") — take the leading field, not the line.
  const types = out.split('\n').map((l) => l.trim().split(',')[0]).filter(Boolean)
  const total = types.length
  const keyIdx = []
  types.forEach((t, i) => t === 'I' && keyIdx.push(i))
  let maxGop = keyIdx.length ? 1 : 0
  for (let i = 1; i < keyIdx.length; i++) maxGop = Math.max(maxGop, keyIdx[i] - keyIdx[i - 1])
  if (keyIdx.length) maxGop = Math.max(maxGop, total - keyIdx[keyIdx.length - 1])
  return { total, keyframes: keyIdx.length, maxGop }
}

/** moov-before-mdat, read from the file's own top-level box layout — not ffmpeg's trace log,
 * which is a debug format that can change shape across versions. Returns null when neither box
 * is found (not a box-structured/MP4 file). */
function readFastStart(path) {
  const size = statSync(path).size
  const fd = openSync(path, 'r')
  try {
    let pos = 0
    let moovAt = -1
    let mdatAt = -1
    const header = Buffer.alloc(8)
    while (pos + 8 <= size) {
      readSync(fd, header, 0, 8, pos)
      let boxSize = header.readUInt32BE(0)
      const type = header.toString('ascii', 4, 8)
      let headerLen = 8
      if (boxSize === 1) {
        const big = Buffer.alloc(8)
        readSync(fd, big, 0, 8, pos + 8)
        boxSize = Number(big.readBigUInt64BE(0))
        headerLen = 16
      }
      if (type === 'moov' && moovAt === -1) moovAt = pos
      if (type === 'mdat' && mdatAt === -1) mdatAt = pos
      if (moovAt !== -1 && mdatAt !== -1) break
      if (boxSize === 0) break // this box runs to EOF — nothing follows it to find
      if (boxSize < headerLen) break // malformed; stop rather than loop
      pos += boxSize
    }
    if (moovAt === -1 || mdatAt === -1) return null
    return moovAt < mdatAt
  } finally {
    closeSync(fd)
  }
}

/** codec/profile, resolution, fps, duration, keyframe count + max GOP, faststart, audio presence,
 * and the two verdicts `media probe` prints. */
export function probeVideo(path) {
  const meta = ffprobeFormat(path)
  const vStream = (meta.streams ?? []).find((s) => s.codec_type === 'video')
  if (!vStream) throw new Error(`${path}: no video stream`)
  const audio = (meta.streams ?? []).some((s) => s.codec_type === 'audio')
  const [num, den] = String(vStream.avg_frame_rate ?? vStream.r_frame_rate ?? '0/1').split('/').map(Number)
  const fps = den ? num / den : 0
  const duration = Number(meta.format?.duration ?? vStream.duration ?? 0)
  const { total, keyframes, maxGop } = keyframeStats(path)
  const faststart = readFastStart(path)
  const allIntra = total > 0 && keyframes === total
  const scrubReady = allIntra || (maxGop > 0 && maxGop <= 2)
  const webSafe = vStream.codec_name === 'h264' && /^(high|main)/i.test(vStream.profile ?? '') && vStream.pix_fmt === 'yuv420p' && faststart === true
  return {
    path,
    codec: vStream.codec_name ?? null,
    profile: vStream.profile ?? null,
    width: vStream.width ?? null,
    height: vStream.height ?? null,
    fps,
    duration,
    pixFmt: vStream.pix_fmt ?? null,
    audio,
    frames: total,
    keyframes,
    maxGop,
    faststart,
    allIntra,
    verdicts: { scrubReady, webSafe }
  }
}

// ── encoding ────────────────────────────────────────────────────────────

function scaleFilters({ width, fps }) {
  const f = []
  if (fps) f.push(`fps=${fps}`)
  if (width) f.push(`scale=${width}:-2`)
  return f
}

/** One frame to webp/jpg/png (by `out`'s extension — webp falls back to png when this ffmpeg
 * build has no libwebp encoder), from `input` at `at` seconds. Input-side -ss is both fast
 * (keyframe-adjacent) and frame-accurate on modern ffmpeg. Returns the path actually written,
 * which only differs from `out` on that fallback. */
export function extractPoster(input, out, { at = 0, width } = {}) {
  const { path: dest, codec } = stillOut(out)
  ensureDirFor(dest)
  const filters = scaleFilters({ width })
  ffmpeg(['-ss', String(at), '-i', input, '-frames:v', '1', ...(filters.length ? ['-vf', filters.join(',')] : []), '-c:v', codec, dest])
  return dest
}

/** All-intra H.264 for scrubbing (references/video.md §1's recipe, verbatim: -preset slow, the
 * four x264-params bundled together), plus an optional --mobile width variant and a poster pulled
 * from the encoded output (§9: never from the source master). */
export function encodeScrub(input, { out, width, crf = 23, fps, mobile, posterAt = 0 } = {}) {
  const primary = out ?? defaultOut(input, 'scrub')
  const encode = (dest, w) => {
    ensureDirFor(dest)
    const filters = scaleFilters({ width: w, fps })
    ffmpeg(['-i', input, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-x264-params', 'keyint=1:min-keyint=1:scenecut=0:qcomp=1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', ...(filters.length ? ['-vf', filters.join(',')] : []), dest])
    return dest
  }
  const primaryOut = encode(primary, width)
  const result = { primary: primaryOut }
  if (mobile) result.mobile = encode(withSuffix(primary, '-mobile'), mobile)
  result.poster = extractPoster(primaryOut, posterFor(primary), { at: posterAt })
  return result
}

/** A normal-GOP, faststart, silent loop encode, plus a poster from the encoded output. */
export function encodeLoop(input, { out, width, fps, crf = 23, posterAt = 0 } = {}) {
  const primary = out ?? defaultOut(input, 'loop')
  ensureDirFor(primary)
  const filters = scaleFilters({ width, fps })
  ffmpeg(['-i', input, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', ...(filters.length ? ['-vf', filters.join(',')] : []), primary])
  const poster = extractPoster(primary, posterFor(primary), { at: posterAt })
  return { primary, poster }
}

function evenHeight(srcW, srcH, width) {
  const h = Math.round((srcH * width) / srcW)
  return h % 2 === 0 ? h : h + 1
}

/** N evenly spaced (centred: (i+0.5)/N of the duration) frames as 0001.webp… (png if this ffmpeg
 * build has no libwebp — see stillFormat), plus manifest.json. --mobile-width writes a second,
 * independent set (its own manifest) under <out>/mobile/. */
export function extractSequence(input, outDir, { frames = 24, width, quality = 80, mobileWidth } = {}) {
  const probed = probeVideo(input)
  const q = Math.max(0, Math.min(100, quality))
  const { ext, codec } = stillFormat() // decided once: every frame of every set shares one format
  const buildSet = (dir, w) => {
    mkdirSync(dir, { recursive: true })
    const names = []
    let bytes = 0
    for (let i = 0; i < frames; i++) {
      const t = ((i + 0.5) * probed.duration) / frames
      const name = `${String(i + 1).padStart(4, '0')}.${ext}`
      const dest = join(dir, name)
      const filters = scaleFilters({ width: w })
      const qualityArgs = codec === 'libwebp' ? ['-q:v', String(q)] : []
      ffmpeg(['-ss', String(t), '-i', input, '-frames:v', '1', ...(filters.length ? ['-vf', filters.join(',')] : []), '-c:v', codec, ...qualityArgs, dest])
      bytes += statSync(dest).size
      names.push(name)
    }
    const manifest = {
      count: frames,
      width: w ?? probed.width,
      height: w ? evenHeight(probed.width, probed.height, w) : probed.height,
      format: ext,
      frames: names,
      bytes
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    return manifest
  }
  const primary = buildSet(outDir, width)
  const result = { outDir, primary }
  if (mobileWidth) result.mobile = buildSet(join(outDir, 'mobile'), mobileWidth)
  return result
}
