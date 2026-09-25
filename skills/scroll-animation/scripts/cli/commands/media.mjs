// media.mjs — scroll-animation media probe|scrub|loop|sequence|poster <input> [--out] [flags]
// ffmpeg/ffprobe recipes live in scripts/lib/media.mjs; this is argv parsing and printing only.

import { existsSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { checkFfmpeg, encodeLoop, encodeScrub, extractPoster, extractSequence, posterFor, probeVideo } from '../../lib/media.mjs'
import { numFlag } from '../args.mjs'
import { CliError, c, fail } from '../ui.mjs'

const SUBCOMMANDS = ['probe', 'scrub', 'loop', 'sequence', 'poster']

export const MEDIA_USAGE = `scroll-animation media <command> <input> [--out <path>] [flags]

  media probe <input>
      codec/profile, resolution, fps, duration, keyframes, max GOP, faststart, audio; verdicts
      scrub-ready (all-intra or GOP <= 2) and web-safe (H.264 High/Main, yuv420p, faststart)
  media scrub <input> [--out] [--width px] [--crf 23] [--fps n] [--mobile width]
      all-intra H.264 for scrubbing (references/video.md §1) + a --mobile variant + a poster
  media loop <input> [--out] [--width px] [--fps n] [--crf 23]
      web-safe loop encode (normal GOP, faststart, no audio) + a poster
  media sequence <input> --out <dir> [--frames 24] [--width px] [--quality 80] [--mobile-width px]
      N evenly spaced frames to <dir>/0001.webp… + manifest.json; --mobile-width adds <dir>/mobile/
  media poster <input> [--out] [--at 0]
      one frame (webp, or jpg by --out's extension)`

function strFlag(flags, name, { required = false } = {}) {
  if (flags[name] === undefined) {
    if (required) fail(`--${name} is required`, 2)
    return undefined
  }
  if (flags[name] === true) fail(`--${name} wants a value`, 2)
  return String(flags[name])
}

const posIntFlag = (flags, name, extra = {}) => numFlag(flags, name, { min: 1, integer: true, ...extra })

export async function cmdMedia(flags, positionals) {
  const [sub, input] = positionals
  if (!sub) fail(`media wants a command: ${SUBCOMMANDS.join(', ')}\n\n${MEDIA_USAGE}`, 2)
  if (!SUBCOMMANDS.includes(sub)) fail(`unknown media command "${sub}" (${SUBCOMMANDS.join(', ')})`, 2)
  if (!input) fail(`media ${sub} wants an input file`, 2)
  const inputPath = resolvePath(input)
  if (!existsSync(inputPath)) fail(`${input}: no such file`, 2)

  try {
    checkFfmpeg()
  } catch (err) {
    fail(err.message, 1)
  }

  try {
    if (sub === 'probe') return printProbe(probeVideo(inputPath))
    if (sub === 'scrub') return printScrub(runScrub(inputPath, flags))
    if (sub === 'loop') return printLoop(runLoop(inputPath, flags))
    if (sub === 'sequence') return printSequence(runSequence(inputPath, flags))
    return printPoster(runPoster(inputPath, flags))
  } catch (err) {
    // A CliError (e.g. --out is required, exit 2) already carries the right code — only a raw
    // failure from ffmpeg/ffprobe or the filesystem gets wrapped as an exit-1 "problem".
    if (err instanceof CliError) throw err
    fail(err instanceof Error ? err.message : String(err), 1)
  }
}

// ── run: flags -> scripts/lib/media.mjs call ────────────────────────────

function runScrub(input, flags) {
  return encodeScrub(input, {
    out: strFlag(flags, 'out'),
    width: posIntFlag(flags, 'width'),
    crf: numFlag(flags, 'crf', { def: 23, min: 0, max: 51, integer: true }),
    fps: posIntFlag(flags, 'fps'),
    mobile: posIntFlag(flags, 'mobile')
  })
}

function runLoop(input, flags) {
  return encodeLoop(input, {
    out: strFlag(flags, 'out'),
    width: posIntFlag(flags, 'width'),
    fps: posIntFlag(flags, 'fps'),
    crf: numFlag(flags, 'crf', { def: 23, min: 0, max: 51, integer: true })
  })
}

function runSequence(input, flags) {
  const out = strFlag(flags, 'out', { required: true })
  return extractSequence(input, out, {
    frames: numFlag(flags, 'frames', { def: 24, min: 1, integer: true }),
    width: posIntFlag(flags, 'width'),
    quality: numFlag(flags, 'quality', { def: 80, min: 0, max: 100, integer: true }),
    mobileWidth: posIntFlag(flags, 'mobile-width')
  })
}

function runPoster(input, flags) {
  const out = strFlag(flags, 'out') ?? posterFor(input)
  return extractPoster(input, out, { at: numFlag(flags, 'at', { def: 0, min: 0 }) })
}

// ── print ────────────────────────────────────────────────────────────────

function printProbe(p) {
  console.log(c.bold(p.path))
  console.log(`  codec        ${p.codec ?? 'unknown'}${p.profile ? ` (${p.profile})` : ''}, ${p.pixFmt ?? 'unknown pixel format'}`)
  console.log(`  resolution   ${p.width}x${p.height} @ ${p.fps.toFixed(2)}fps, ${p.duration.toFixed(2)}s`)
  console.log(`  keyframes    ${p.keyframes}/${p.frames} frames, max GOP ${p.maxGop}${p.allIntra ? ' (all-intra)' : ''}`)
  console.log(`  faststart    ${p.faststart === null ? 'unknown' : p.faststart ? 'yes' : 'no'}`)
  console.log(`  audio        ${p.audio ? 'yes' : 'no'}`)
  console.log(`  verdicts     ${p.verdicts.scrubReady ? c.green('scrub-ready') : c.dim('not scrub-ready')} · ${p.verdicts.webSafe ? c.green('web-safe') : c.dim('not web-safe')}`)
}

function printScrub(r) {
  console.log(`${c.green('✓')} ${r.primary}`)
  if (r.mobile) console.log(`${c.green('✓')} ${r.mobile} ${c.dim('(mobile)')}`)
  console.log(`${c.green('✓')} ${r.poster} ${c.dim('(poster)')}`)
}

function printLoop(r) {
  console.log(`${c.green('✓')} ${r.primary}`)
  console.log(`${c.green('✓')} ${r.poster} ${c.dim('(poster)')}`)
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function printSequence(r) {
  console.log(`${c.green('✓')} ${r.outDir} — ${r.primary.count} frame(s), ${r.primary.width}x${r.primary.height}, ${formatBytes(r.primary.bytes)}`)
  if (r.mobile) console.log(`${c.green('✓')} ${join(r.outDir, 'mobile')} — ${r.mobile.count} frame(s), ${r.mobile.width}x${r.mobile.height}, ${formatBytes(r.mobile.bytes)}`)
}

function printPoster(out) {
  console.log(`${c.green('✓')} ${out}`)
}
