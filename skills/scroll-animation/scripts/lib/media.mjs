// media.mjs — the ffmpeg/ffprobe recipes behind `scroll-animation media …`. Pure functions: no
// argv parsing, no console output. cli/commands/media.mjs is the thin layer that calls these and
// prints. Every recipe shells out to ffmpeg/ffprobe on PATH — never a bundled binary, no npm
// dependency.

import { spawnSync } from 'node:child_process'
import { openSync, closeSync, readSync, statSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

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
// Without libwebp in ffmpeg, Google's `cwebp` (brew install webp) still gets real WebP: ffmpeg writes a lossless
// PNG and cwebp encodes it. Only when neither exists do stills stay PNG (several times larger for photographic
// frames, which matters for an image sequence).
let cwebpAvailable
function hasCwebp() {
  if (cwebpAvailable === undefined) cwebpAvailable = spawnSync('cwebp', ['-version'], { stdio: 'ignore' }).status === 0
  return cwebpAvailable
}
function cwebp(pngPath, webpPath, quality) {
  run('cwebp', ['-quiet', '-q', String(quality), '-metadata', 'none', pngPath, '-o', webpPath])
  unlinkSync(pngPath)
}
let warnedWebpFallback = false
function warnWebpFallback() {
  if (warnedWebpFallback) return
  warnedWebpFallback = true
  process.stderr.write(
    hasCwebp()
      ? 'media: this ffmpeg build has no libwebp encoder; encoding WebP with cwebp instead.\n'
      : 'media: no libwebp in ffmpeg and no cwebp on PATH: writing PNG stills (brew install webp for WebP).\n',
  )
}
/** The still format for one call, decided once (a sequence's frames all share one format; mixing would make the
 * manifest a lie). `viaCwebp`: ffmpeg writes PNG, then cwebp converts it. */
function stillFormat() {
  if (hasWebpEncoder()) return { ext: 'webp', codec: 'libwebp', viaCwebp: false }
  warnWebpFallback()
  if (hasCwebp()) return { ext: 'webp', codec: 'png', viaCwebp: true }
  return { ext: 'png', codec: 'png', viaCwebp: false }
}
/** The codec (and, if WebP can't be written at all, the corrected path) for one explicit `out` path:
 * .jpg/.jpeg → mjpeg, .png → png, anything else (including .webp) → webp (ffmpeg's libwebp, or cwebp), else png
 * — with the path's extension swapped to match what actually got written. */
function stillOut(desiredPath) {
  const ext = extname(desiredPath).slice(1).toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return { path: desiredPath, codec: 'mjpeg', viaCwebp: false }
  if (ext === 'png') return { path: desiredPath, codec: 'png', viaCwebp: false }
  if (hasWebpEncoder()) return { path: desiredPath, codec: 'libwebp', viaCwebp: false }
  warnWebpFallback()
  if (hasCwebp()) return { path: desiredPath.replace(/\.[^./]+$/, '.webp'), codec: 'png', viaCwebp: true }
  return { path: desiredPath.replace(/\.[^./]+$/, '.png'), codec: 'png', viaCwebp: false }
}

// ── path helpers ────────────────────────────────────────────────────────

function splitExt(p) {
  const ext = extname(p)
  return [p.slice(0, p.length - ext.length), ext]
}
/** input.mov, 'scrub' → input-scrub.mp4, next to the input. Always .mp4 whatever came in: every encode here is
 * faststart H.264 for the web, and a .mov/.mkv default would carry the source's container into production. An
 * explicit --out is used as given. */
function defaultOut(input, tag) {
  const [base] = splitExt(input)
  return `${base}-${tag}.mp4`
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

/** Per-frame key flags in presentation order (references/video.md §13: the probe behind `media probe`): total frame
 * count, the keyframe indices, and the max span in frames between consecutive keyframes (an all-intra file spans 1;
 * a normal GOP-N file spans ~N). A keyframe is a random-access point (`key_frame`), which a browser can seek to; an
 * I-picture that isn't one only counts when the build reports no key flag at all. */
function keyframeStats(path) {
  const out = ffprobe(['-select_streams', 'v:0', '-show_entries', 'frame=key_frame,pict_type', '-of', 'compact=p=0', path])
  // Named fields rather than csv: a frame carrying side data (typically the first keyframe) gets an extra empty
  // field on some ffprobe builds ("key_frame=1|pict_type=I|"), and field order isn't ours to rely on.
  const keyIdx = []
  let total = 0
  for (const line of out.split('\n')) {
    const fields = Object.fromEntries(line.split('|').filter((f) => f.includes('=')).map((f) => f.trim().split('=')))
    if (fields.key_frame === undefined && fields.pict_type === undefined) continue
    if (fields.key_frame !== undefined ? fields.key_frame === '1' : fields.pict_type === 'I') keyIdx.push(total)
    total++
  }
  let maxGop = keyIdx.length ? 1 : 0
  for (let i = 1; i < keyIdx.length; i++) maxGop = Math.max(maxGop, keyIdx[i] - keyIdx[i - 1])
  if (keyIdx.length) maxGop = Math.max(maxGop, total - keyIdx[keyIdx.length - 1])
  return { total, keyIdx, maxGop }
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

/** codec/profile, resolution, fps, duration, keyframe count + indices + max GOP, faststart, audio
 * presence, and the two verdicts `media probe` prints. */
export function probeVideo(path) {
  const meta = ffprobeFormat(path)
  const vStream = (meta.streams ?? []).find((s) => s.codec_type === 'video')
  if (!vStream) throw new Error(`${path}: no video stream`)
  const audio = (meta.streams ?? []).some((s) => s.codec_type === 'audio')
  const [num, den] = String(vStream.avg_frame_rate ?? vStream.r_frame_rate ?? '0/1').split('/').map(Number)
  const fps = den ? num / den : 0
  const duration = Number(meta.format?.duration ?? vStream.duration ?? 0)
  const { total, keyIdx, maxGop } = keyframeStats(path)
  const keyframes = keyIdx.length
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
    keyframeIndices: keyIdx,
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

/** Video encodes: tag BT.709 in the stream itself. ffmpeg 8 ignores -color_primaries / -color_trc on output for
 * these streams; untagged, Safari and Chrome can pick different matrices and the same file shifts colour. */
const BT709 = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709'
function videoFilters({ width, fps }) {
  return [...scaleFilters({ width, fps }), BT709]
}

/** Stills from a video: an accurate limited-to-full-range conversion. ffmpeg's fast YUV→RGB path lands 2–3 levels
 * dark (paper 243,239,230 instead of 245,241,233), so a poster visibly steps when the video starts over it. */
function stillFilters({ width }) {
  const size = width ? `w=${width}:h=-2:` : ''
  return [`scale=${size}flags=lanczos+accurate_rnd+full_chroma_int:in_range=tv:out_range=pc`, 'format=rgb24']
}

/** One frame to webp/jpg/png (by `out`'s extension — webp falls back to png when this ffmpeg
 * build has no libwebp encoder), from `input` at `at` seconds. Input-side -ss is both fast
 * (keyframe-adjacent) and frame-accurate on modern ffmpeg. Returns the path actually written,
 * which only differs from `out` on that fallback. */
export function extractPoster(input, out, { at = 0, width } = {}) {
  const { path: dest, codec, viaCwebp } = stillOut(out)
  ensureDirFor(dest)
  const filters = stillFilters({ width })
  const written = viaCwebp ? dest.replace(/\.webp$/, '.tmp.png') : dest
  ffmpeg(['-ss', String(at), '-i', input, '-frames:v', '1', '-vf', filters.join(','), '-c:v', codec, written])
  if (viaCwebp) cwebp(written, dest, 82)
  return dest
}

/** All-intra H.264 for scrubbing (references/video.md §13's recipe, verbatim: -preset slow, the
 * four x264-params bundled together), plus an optional --mobile width variant and a poster pulled
 * from the encoded output (§9: never from the source master). */
export function encodeScrub(input, { out, width, crf = 23, fps, mobile, posterAt = 0 } = {}) {
  const primary = out ?? defaultOut(input, 'scrub')
  const encode = (dest, w) => {
    ensureDirFor(dest)
    const filters = videoFilters({ width: w, fps })
    ffmpeg(['-i', input, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-x264-params', 'keyint=1:min-keyint=1:scenecut=0:qcomp=1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-vf', filters.join(','), dest])
    return dest
  }
  const primaryOut = encode(primary, width)
  const result = { primary: primaryOut }
  if (mobile) result.mobile = encode(withSuffix(primary, '-mobile'), mobile)
  result.poster = extractPoster(primaryOut, posterFor(primary), { at: posterAt })
  return result
}

/** A request the input can't satisfy, such as a frame it doesn't have. The CLI reports it as a usage error (exit 2). */
export class MediaRangeError extends RangeError {}

/** Frames an encode will hold: the source's own count, or duration × fps when `fps` resamples it. */
function encodedFrames(probed, fps) {
  if (fps && Math.abs(fps - probed.fps) > 1e-3) return Math.max(1, Math.round(probed.duration * fps))
  return probed.frames > 0 ? probed.frames : Math.max(1, Math.round(probed.duration * probed.fps))
}

/** An fps for LoopVideo's `fps` prop: exact for whole rates, six decimals otherwise (30000/1001 → 29.97003, a
 * seam-time error in the nanoseconds). */
export function formatFps(fps) {
  return Number.isInteger(fps) ? String(fps) : String(Number(fps.toFixed(6)))
}

/** A one-GOP, faststart, silent loop encode, plus a poster from the encoded output. `loopFrom` is for an
 * intro-then-seam loop (LoopVideo `loopFromFrame`): it forces a second keyframe at that frame, so each re-entry
 * decodes from the seam itself instead of from frame 0 (references/video.md §10), and appends one spare frame, a
 * clone of the last. It throws a MediaRangeError outside 1..frames−1 and verifies both keyframes on the encoded
 * file. */
export function encodeLoop(input, { out, width, fps, crf = 23, posterAt = 0, loopFrom } = {}) {
  const primary = out ?? defaultOut(input, 'loop')
  const probed = probeVideo(input)
  const frames = encodedFrames(probed, fps)
  if (loopFrom !== undefined && !(Number.isInteger(loopFrom) && loopFrom >= 1 && loopFrom <= frames - 1)) {
    throw new MediaRangeError(`frame ${loopFrom} is outside 1..${frames - 1} (${basename(input)} encodes to ${frames} frames at ${formatFps(fps || probed.fps)} fps)`)
  }
  ensureDirFor(primary)
  // LoopVideo wraps up to a frame early to beat WebKit's end-of-media race, so an intro-then-seam file ends on a
  // spare clone of its last frame: the early wrap only ever skips the clone, never content. Last in the chain, after
  // any fps/scale. A native `loop` plays every frame, so a plain loop gets no spare (it would show as a stutter).
  const spare = loopFrom ? ['tpad=stop_mode=clone:stop=1'] : []
  const filters = [...videoFilters({ width, fps }), ...spare]
  // references/video.md §13: qcomp=1 so byte-identical frames at the seam quantize alike (no pop at the wrap), and
  // one GOP per loop so the loop point is the keyframe. §10: the seam keyframe is forced by frame number (`n`, after
  // any --fps), not by timestamp, so it can't round onto a neighbouring frame.
  const seamKey = loopFrom ? ['-force_key_frames', `expr:eq(n,0)+eq(n,${loopFrom})`] : []
  ffmpeg(['-i', input, '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', String(crf), '-g', String(frames + spare.length), ...seamKey, '-x264-params', 'qcomp=1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-vf', filters.join(','), primary])
  const poster = extractPoster(primary, posterFor(primary), { at: posterAt })
  if (!loopFrom) return { primary, poster }
  const encoded = probeVideo(primary)
  if (!encoded.keyframeIndices.includes(0) || !encoded.keyframeIndices.includes(loopFrom)) {
    throw new Error(`${primary}: expected keyframes at frames 0 and ${loopFrom}, found ${encoded.keyframeIndices.join(', ') || 'none'}`)
  }
  // `frames` is the file's count, spare included; `contentFrames` excludes it.
  return { primary, poster, loopFrom, fps: encoded.fps, frames: encoded.frames, contentFrames: encoded.frames - 1, keyframeIndices: encoded.keyframeIndices }
}

function evenHeight(srcW, srcH, width) {
  const h = Math.round((srcH * width) / srcW)
  return h % 2 === 0 ? h : h + 1
}

/** N evenly spaced frames, first and last included, as 0001.webp… (WebP via libwebp or cwebp, else PNG — see
 * stillFormat), plus manifest.json with the source frame indices. --mobile-width writes a second,
 * independent set (its own manifest) under <out>/mobile/. */
export function extractSequence(input, outDir, { frames = 24, width, quality = 80, mobileWidth } = {}) {
  const probed = probeVideo(input)
  const q = Math.max(0, Math.min(100, quality))
  const { ext, codec, viaCwebp } = stillFormat() // decided once: every frame of every set shares one format
  // Pick exact source frames on the output side, in one pass: evenly spaced indices that include the first and the
  // last frame, so scroll progress 0 and 1 land on the clip's true ends. (Seeking to centred timestamps per frame
  // could land past the last frame's pts on a short clip, where ffmpeg writes nothing and still exits 0.)
  const total = probed.frames > 0 ? probed.frames : Math.max(1, Math.round(probed.duration * probed.fps))
  const count = Math.max(1, Math.min(frames, total))
  const indices = Array.from({ length: count }, (_, i) => (count === 1 ? 0 : Math.round((i * (total - 1)) / (count - 1))))
  const select = `select=${indices.map((n) => `eq(n\\,${n})`).join('+')}`
  const buildSet = (dir, w) => {
    mkdirSync(dir, { recursive: true })
    const filters = [select, ...stillFilters({ width: w })]
    const qualityArgs = codec === 'libwebp' ? ['-q:v', String(q)] : []
    const writtenExt = viaCwebp ? 'png' : ext
    ffmpeg(['-i', input, '-vf', filters.join(','), '-fps_mode', 'vfr', '-c:v', codec, ...qualityArgs, join(dir, `%04d.${writtenExt}`)])
    const names = indices.map((_, i) => `${String(i + 1).padStart(4, '0')}.${ext}`)
    if (viaCwebp) {
      for (const name of names) {
        const png = join(dir, name.replace(/\.webp$/, '.png'))
        try {
          statSync(png)
        } catch {
          break // the count check below reports the shortfall
        }
        cwebp(png, join(dir, name), q)
      }
    }
    let bytes = 0
    for (const name of names) {
      let size
      try {
        size = statSync(join(dir, name)).size
      } catch {
        throw new Error(`media sequence: ffmpeg wrote ${names.indexOf(name)} of ${count} frames into ${dir} (the source has ${total}); nothing past ${name}`)
      }
      bytes += size
    }
    const manifest = {
      count,
      width: w ?? probed.width,
      height: w ? evenHeight(probed.width, probed.height, w) : probed.height,
      format: ext,
      frames: names,
      sourceFrames: indices,
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
