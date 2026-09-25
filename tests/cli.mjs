#!/usr/bin/env node
// cli.mjs — the `scroll-animation` command end to end, in throwaway projects: list, add (copy +
// lock + refuse-on-hand-edit + --force + --dry-run + engine auto-pick from package.json), and
// media probe/sequence (+ a light scrub/poster check) against a tiny ffmpeg-generated clip —
// skipped entirely if ffmpeg/ffprobe aren't on PATH. No browser, no network.

import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, appendFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadRegistry, resolveTransitive, validateRegistry } from '../skills/scroll-animation/scripts/lib/registry.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '../skills/scroll-animation/bin/scroll-animation')
const GENERATE = join(HERE, '../scripts/dev/generate.mjs')

let failures = 0
const expect = (ok, what, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? `\n${extra}` : ''}`)
}
const run = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

// Expectations come from the shipped registry, so adding or renaming a block never breaks these tests.
const REG = loadRegistry()
const blockCount = Object.keys(REG.blocks).length
const countWhere = (pred) => Object.values(REG.blocks).filter(pred).length

const root = mkdtempSync(join(tmpdir(), 'scroll-animation-cli-'))
try {
  // ── list ──────────────────────────────────────────────────────────────
  let r = run(root, 'list')
  expect(r.code === 0 && r.out.includes(`${blockCount} block(s)`) && Object.keys(REG.blocks).every((id) => r.out.includes(id)), 'list prints the whole catalogue', r.out)

  r = run(root, 'list', '--json')
  let json
  try {
    json = JSON.parse(r.out)
  } catch {}
  expect(r.code === 0 && !!json?.stage?.engines?.gsap && !!json?.stage?.engines?.motion, 'list --json is valid JSON with per-engine files', r.out)

  r = run(root, 'list', '--engine', 'css')
  expect(r.code === 0 && r.out.includes(`${countWhere((b) => b.engines.css)} block(s)`) && r.out.includes('base-css') && !r.out.includes('gsap-setup'), 'list --engine keeps only blocks offering that engine', r.out)

  r = run(root, 'list', '--profile', 'reading')
  expect(r.code === 0 && r.out.includes(`${countWhere((b) => b.profiles.includes('reading'))} block(s)`) && !r.out.includes('smooth-lenis'), 'list --profile keeps only blocks for that profile', r.out)

  r = run(root, 'list', '--engine', 'three')
  expect(r.code === 0 && r.out.includes('No blocks match'), 'list --engine with no matches says so instead of erroring', r.out)

  r = run(root, '--version')
  expect(r.code === 0 && /^\d+\.\d+\.\d+$/.test(r.out.trim()), '--version prints a bare semver', r.out)

  // ── registry.mjs: requires across engines (resolveEngineFor) ─────────
  // v1's real blocks never need this yet (every requires edge today matches engines on both
  // sides), so these are synthetic fixture blocks layered onto a clone of the real, shipped
  // registry — reusing real, existing asset/reference files (so validateRegistry's existence
  // checks stay honest) rather than writing new ones. This exercises exactly what `add` and
  // `generate --check` call (resolveTransitive / validateRegistry) without touching the shared
  // assets/registry.json on disk, which other agents are reading and writing concurrently.
  const realRegistry = loadRegistry()
  const fxBlock = (engines, requires) => ({
    summary: 'test fixture',
    clock: 'none',
    tier: 'primitive',
    profiles: ['reading', 'expressive', 'immersive'],
    engines: Object.fromEntries(engines.map((e) => [e, { files: ['gsap/config.ts'], requires: requires ?? [], packages: [] }])),
    reference: 'references/attribute-contract.md'
  })

  // gsap block requiring an agnostic-only block: resolveTransitive copies both.
  const fxAgnostic = structuredClone(realRegistry)
  fxAgnostic.blocks['fx-agnostic-dep'] = fxBlock(['agnostic'])
  fxAgnostic.blocks['fx-needs-agnostic'] = fxBlock(['gsap'], ['fx-agnostic-dep'])
  let resolved = resolveTransitive(fxAgnostic, ['fx-needs-agnostic'], 'gsap')
  expect(resolved.some((e) => e.id === 'fx-agnostic-dep' && e.engine === 'agnostic') && resolved.some((e) => e.id === 'fx-needs-agnostic' && e.engine === 'gsap'), 'resolveTransitive: a gsap block requiring an agnostic-only block copies both', JSON.stringify(resolved))
  expect(validateRegistry(fxAgnostic, { pkgVersion: fxAgnostic.version }).every((p) => !p.includes('fx-agnostic') && !p.includes('fx-needs-agnostic')), 'validateRegistry: the same gsap-requires-agnostic edge is clean', JSON.stringify(validateRegistry(fxAgnostic, { pkgVersion: fxAgnostic.version })))

  // motion block requiring a css-only block: resolveTransitive copies both.
  const fxCss = structuredClone(realRegistry)
  fxCss.blocks['fx-css-dep'] = fxBlock(['css'])
  fxCss.blocks['fx-needs-css'] = fxBlock(['motion'], ['fx-css-dep'])
  resolved = resolveTransitive(fxCss, ['fx-needs-css'], 'motion')
  expect(resolved.some((e) => e.id === 'fx-css-dep' && e.engine === 'css') && resolved.some((e) => e.id === 'fx-needs-css' && e.engine === 'motion'), 'resolveTransitive: a motion block requiring a css-only block copies both', JSON.stringify(resolved))
  expect(validateRegistry(fxCss, { pkgVersion: fxCss.version }).every((p) => !p.includes('fx-css')), 'validateRegistry: the same motion-requires-css edge is clean', JSON.stringify(validateRegistry(fxCss, { pkgVersion: fxCss.version })))

  // ambiguous: a block with two engines, neither matching the requester's — errors in both.
  const fxAmbiguous = structuredClone(realRegistry)
  fxAmbiguous.blocks['fx-two-engines'] = fxBlock(['gsap', 'motion'])
  fxAmbiguous.blocks['fx-needs-ambiguous'] = fxBlock(['three'], ['fx-two-engines'])
  let threw = null
  try {
    resolveTransitive(fxAmbiguous, ['fx-needs-ambiguous'], 'three')
  } catch (err) {
    threw = err
  }
  expect(threw instanceof Error && /fx-two-engines has no "three" engine and several others \(gsap, motion\)/.test(threw.message), 'resolveTransitive: no engine and several others is a clear error, not a silent guess', String(threw))
  const ambiguousProblems = validateRegistry(fxAmbiguous, { pkgVersion: fxAmbiguous.version })
  expect(ambiguousProblems.some((p) => p.includes('fx-needs-ambiguous') && p.includes('fx-two-engines has no "three" engine')), 'generate --check (validateRegistry) reports the same ambiguity', JSON.stringify(ambiguousProblems))

  // a cycle that dips through an engine fallback and back is still caught, on (block, engine) pairs.
  const fxCycle = structuredClone(realRegistry)
  fxCycle.blocks['fx-cycle-a'] = fxBlock(['agnostic'], ['fx-cycle-b'])
  fxCycle.blocks['fx-cycle-b'] = fxBlock(['gsap'], ['fx-cycle-a'])
  threw = null
  try {
    resolveTransitive(fxCycle, ['fx-cycle-b'], 'gsap')
  } catch (err) {
    threw = err
  }
  expect(threw instanceof Error && /requires cycle/.test(threw.message), 'resolveTransitive: a cycle through an engine fallback is still caught', String(threw))
  const cycleProblems = validateRegistry(fxCycle, { pkgVersion: fxCycle.version })
  expect(cycleProblems.some((p) => /requires cycle/.test(p) && p.includes('fx-cycle-a') && p.includes('fx-cycle-b')), 'generate --check (validateRegistry) reports the same cycle', JSON.stringify(cycleProblems))

  // the shipped registry itself has no such edges yet (v1), so it stays entirely clean.
  expect(validateRegistry(realRegistry, { pkgVersion: realRegistry.version }).length === 0, 'the real, shipped registry.json is unaffected by any of the above', JSON.stringify(validateRegistry(realRegistry, { pkgVersion: realRegistry.version })))

  // ── add: greenfield Motion project ──────────────────────────────────
  const m = join(root, 'motion-proj')
  mkdirSync(m, { recursive: true })
  writeFileSync(join(m, 'package.json'), JSON.stringify({ dependencies: { motion: '^12.0.0', react: '^19.0.0' } }))

  r = run(m, 'add', 'stage')
  expect(r.code === 0 && !/Install: .*\bmotion\b/.test(r.out), 'add auto-picks the engine matching an installed dependency and skips packages already installed', r.out)
  const stageFiles = resolveTransitive(REG, ['stage'], 'motion').flatMap((entry) => entry.files)
  expect(stageFiles.includes('motion/components/Stage.tsx') && stageFiles.includes('css/animation.css'), 'stage (motion) resolves its own files plus its requires across engines')
  for (const f of stageFiles) expect(existsSync(join(m, 'src/animation', f)), `add copied ${f} (stage + its requires)`)
  expect(existsSync(join(m, 'src/animation/.scroll-animation.lock.json')), 'add wrote the lock file')
  const lock1 = JSON.parse(readFileSync(join(m, 'src/animation/.scroll-animation.lock.json'), 'utf8'))
  expect(lock1.dir === 'src/animation' && lock1.engines.includes('motion') && Object.keys(lock1.files).length === stageFiles.length, 'the lock records dir, engine and every file hash', JSON.stringify(lock1))

  r = run(m, 'add', 'stage')
  expect(r.code === 0 && r.out.includes('nothing to write') && r.out.includes('up to date'), 'a second, identical add is a no-op', r.out)

  appendFileSync(join(m, 'src/animation/motion/lib/cx.ts'), '// mine\n')
  r = run(m, 'add', 'stage')
  expect(r.code === 1 && r.out.includes('Refusing to overwrite') && r.out.includes('cx.ts'), 'add refuses to overwrite a hand-edited file, and nothing else runs', r.out)
  expect(readFileSync(join(m, 'src/animation/motion/lib/cx.ts'), 'utf8').includes('// mine'), 'the hand edit survives the refusal (nothing was written)')

  r = run(m, 'add', 'stage', '--force')
  expect(r.code === 0 && !readFileSync(join(m, 'src/animation/motion/lib/cx.ts'), 'utf8').includes('// mine'), '--force overwrites the hand edit', r.out)

  r = run(m, 'add', 'scrub-video', '--dry-run')
  expect(r.code === 0 && r.out.includes('dry run') && /write\s+motion\/ScrubVideo\.tsx/.test(r.out), '--dry-run reports what it would write', r.out)
  expect(!existsSync(join(m, 'src/animation/motion/ScrubVideo.tsx')), '--dry-run left the filesystem untouched')

  // ── add: greenfield GSAP project, --dir, and reusing the lock's dir ──
  const g = join(root, 'gsap-proj')
  mkdirSync(g, { recursive: true })
  writeFileSync(join(g, 'package.json'), JSON.stringify({ dependencies: { gsap: '^3.13.0' } }))

  r = run(g, 'add', 'scroll-well', '--dir', 'lib/motion')
  expect(r.code === 0, 'add --dir writes to a custom directory', r.out)
  for (const f of ['gsap/scrollPull.ts', 'gsap/config.ts', 'gsap/eases.ts']) expect(existsSync(join(g, 'lib/motion', f)), `custom --dir got ${f}`)

  r = run(g, 'add', 'header-theme')
  expect(r.code === 0 && existsSync(join(g, 'lib/motion/gsap/headerTheme.ts')), "a later add with no --dir reuses the lock's recorded directory", r.out)
  expect(!existsSync(join(g, 'src/animation')), 'no default src/animation was created once a lock directory existed')
  const lock2 = JSON.parse(readFileSync(join(g, 'lib/motion/.scroll-animation.lock.json'), 'utf8'))
  expect(Object.keys(lock2.files).some((f) => f.includes('headerTheme')) && Object.keys(lock2.files).some((f) => f.includes('scrollPull')), 'the lock accumulates files across separate add calls', JSON.stringify(lock2))

  // ── add: engine disambiguation ───────────────────────────────────────
  const amb = join(root, 'ambiguous')
  mkdirSync(amb, { recursive: true })
  writeFileSync(join(amb, 'package.json'), JSON.stringify({}))
  r = run(amb, 'add', 'stage')
  expect(r.code === 2 && r.out.includes('--engine'), 'add fails clearly (usage) when no installed dependency picks an engine', r.out)
  r = run(amb, 'add', 'stage', '--engine', 'gsap')
  expect(r.code === 0 && existsSync(join(amb, 'src/animation/gsap/stage.ts')), '--engine overrides when auto-detection is ambiguous', r.out)

  const both = join(root, 'both-engines')
  mkdirSync(both, { recursive: true })
  writeFileSync(join(both, 'package.json'), JSON.stringify({ dependencies: { gsap: '^3', motion: '^12' } }))
  r = run(both, 'add', 'stage')
  expect(r.code === 2 && r.out.includes('more than one'), 'add fails clearly when more than one installed dependency matches', r.out)

  // single-engine blocks ignore a non-matching --engine instead of failing
  const single = join(root, 'single-engine')
  mkdirSync(single, { recursive: true })
  writeFileSync(join(single, 'package.json'), JSON.stringify({}))
  r = run(single, 'add', 'base-css', '--engine', 'gsap')
  expect(r.code === 0 && existsSync(join(single, 'src/animation/css/animation.css')), "a single-engine block uses its own engine even if --engine names another", r.out)

  // ── add: usage errors ─────────────────────────────────────────────────
  r = run(root, 'add', 'not-a-real-block')
  expect(r.code === 2 && r.out.includes('unknown block'), 'add rejects an unknown block id', r.out)
  r = run(root, 'add')
  expect(r.code === 2, 'add with no block ids is a usage error', r.out)

  // ── help ──────────────────────────────────────────────────────────────
  r = run(root, '--help')
  expect(r.code === 0 && r.out.includes('scroll-animation add') && r.out.includes('scroll-animation list') && r.out.includes('scroll-animation media'), '--help lists every command', r.out)
  r = run(root, 'add', '--help')
  expect(r.code === 0 && r.out.includes('scroll-animation add') && !r.out.includes('block(s)'), 'add --help prints usage and runs nothing', r.out)
  r = run(root, 'media', '--help')
  expect(r.code === 0 && r.out.includes('media scrub') && r.out.includes('media sequence') && r.out.includes('media poster'), 'media --help lists every subcommand', r.out)
  r = run(root, 'bogus-command')
  expect(r.code === 2 && r.out.includes('unknown command'), 'an unknown command is a usage error', r.out)

  // ── media: argument validation (no ffmpeg required) ─────────────────
  r = run(root, 'media')
  expect(r.code === 2 && r.out.includes('media wants a command'), 'media with no subcommand is a usage error', r.out)
  r = run(root, 'media', 'bogus', 'x.mp4')
  expect(r.code === 2 && r.out.includes('unknown media command'), 'media rejects an unknown subcommand', r.out)
  r = run(root, 'media', 'probe', 'no-such-file.mp4')
  expect(r.code === 2 && r.out.includes('no such file'), 'media probe on a missing input is a usage error', r.out)
  r = run(root, 'media', 'sequence')
  expect(r.code === 2 && r.out.includes('wants an input'), 'media sequence with no input is a usage error', r.out)

  // ── scripts/dev/generate.mjs --check ─────────────────────────────────
  const gen = spawnSync(process.execPath, [GENERATE, '--check'], { encoding: 'utf8' })
  expect(gen.status === 0 && gen.stdout.includes('registry OK'), 'scripts/dev/generate.mjs --check passes on the shipped registry.json', gen.stdout + gen.stderr)

  // ── media: probe/sequence (+ a light scrub/poster check) on a real clip ──
  const hasFfmpeg = !spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error && !spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).error
  if (!hasFfmpeg) {
    console.log('skip  media probe/scrub/sequence/poster — ffmpeg/ffprobe not on PATH')
  } else {
    const media = join(root, 'media')
    mkdirSync(media, { recursive: true })
    const clip = join(media, 'clip.mp4')
    const enc = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=1', '-pix_fmt', 'yuv420p', clip])
    expect(enc.status === 0, 'generated a tiny test clip with ffmpeg', String(enc.stderr))

    r = run(media, 'media', 'probe', 'clip.mp4')
    expect(r.code === 0 && /resolution\s+320x240 @ 24\.00fps/.test(r.out) && /verdicts/.test(r.out), 'media probe reports resolution, fps and verdicts', r.out)

    r = run(media, 'media', 'sequence', 'clip.mp4', '--out', 'seq', '--frames', '3', '--width', '160')
    expect(r.code === 0, 'media sequence exits 0', r.out)
    const manifestPath = join(media, 'seq/manifest.json')
    expect(existsSync(manifestPath), 'media sequence wrote manifest.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      expect(manifest.count === 3 && manifest.frames.length === 3 && manifest.width === 160 && manifest.bytes > 0, 'the manifest has count/width/bytes', JSON.stringify(manifest))
      expect(['webp', 'png'].includes(manifest.format) && manifest.frames.every((f) => f.endsWith(`.${manifest.format}`)), 'every frame name matches the manifest format (png when this ffmpeg build has no libwebp)', JSON.stringify(manifest))
      expect(manifest.frames.every((f) => existsSync(join(media, 'seq', f))), 'every frame in the manifest exists on disk')
    }

    r = run(media, 'media', 'scrub', 'clip.mp4', '--width', '160')
    expect(r.code === 0 && existsSync(join(media, 'clip-scrub.mp4')), 'media scrub writes an encoded output', r.out)
    r = run(media, 'media', 'probe', 'clip-scrub.mp4')
    expect(/verdicts\s+scrub-ready/.test(r.out), 'the scrub encode probes back as scrub-ready (all-intra)', r.out)

    r = run(media, 'media', 'poster', 'clip.mp4', '--at', '0')
    expect(r.code === 0, 'media poster exits 0', r.out)
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(failures ? `${failures} failure(s)` : 'all passed')
process.exit(failures ? 1 : 0)
