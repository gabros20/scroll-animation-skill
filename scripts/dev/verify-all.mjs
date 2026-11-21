#!/usr/bin/env node
// verify-all.mjs: what CI runs (.github/workflows/ci.yml and check-sync.yml), in one command, so a regression the
// browser suites would catch doesn't wait for CI. `npm run verify` stays the quick gate (check-sync and `npm test`);
// this adds every browser suite, the Folio example's checks and the storefront's.
//
//   npm run verify:all [-- --browsers chromium] [--skip folio,site] [--only foundation,rail]
//
// --browsers   passed to every suite that takes it (CI: each suite's own default; usegsap-teardown and hero are
//              Chromium there)
// --skip       leave out a group: folio (pnpm build, check:authority, verify:scenes), site (pnpm build, check)
// --only       run only the named steps (the names in the summary)
//
// Every step runs, even after a failure; the summary lists each with its exit code and time, and the exit code is 1
// if any step failed. A step whose install is missing (examples/folio or site without node_modules, Folio without its
// media) is SKIPPED, says why, and fails nothing: install it to run it. HARNESS_CHROME (tests/lib/harness.mjs) passes
// through to every suite.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const folio = join(repo, 'examples', 'folio')
const site = join(repo, 'site')

function parseArgs(argv) {
  const out = { browsers: null, skip: [], only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i]
    else if (a === '--skip') out.skip = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const browsers = (fallback) => (args.browsers ? ['--browsers', args.browsers] : fallback ? ['--browsers', fallback] : [])
const npm = (script, extra = []) => ({ cmd: 'npm', argv: ['run', script, ...(extra.length ? ['--', ...extra] : [])], cwd: repo })
const pnpm = (cwd, script, extra = []) => ({ cmd: 'pnpm', argv: [script, ...extra], cwd })
const needs = (dir, what) => (existsSync(join(dir, 'node_modules')) ? null : `no ${what} install (pnpm install --frozen-lockfile in ${what})`)

// [name, CI job, command, why it can't run here (null: it can)]
const STEPS = [
  ['check-sync', 'check-sync', npm('check-sync')],
  ['test', 'test', npm('test')],
  // The browser and media jobs make the test clip first (npm test's own pretest does too; --only may skip it).
  ['pretest', 'media', npm('pretest')],
  ['foundation', 'browsers', npm('test:foundation', browsers())],
  ['traces', 'browsers', npm('test:traces', browsers())],
  ['route-hygiene', 'browsers', npm('test:route-hygiene', ['--contract', 'on', ...browsers()]), needs(folio, 'examples/folio')],
  ['render-bridge', 'browsers', npm('test:render-bridge', browsers()), needs(folio, 'examples/folio')],
  ['sequence', 'media', npm('test:sequence', browsers())],
  ['loop-video', 'media', npm('test:loop-video', browsers())],
  ['scrub-video', 'media', npm('test:scrub-video', browsers())],
  ['harness', 'blocks', npm('test:harness', browsers())],
  ['reveal', 'blocks', npm('test:reveal', browsers())],
  // Chromium in CI until it has passed in WebKit and Firefox: `-- --browsers chromium,webkit,firefox` runs all three.
  ['hero', 'blocks', npm('test:hero', browsers('chromium'))],
  ['rail', 'blocks', npm('test:rail', browsers())],
  ['text', 'blocks', npm('test:text', browsers())],
  ['scroll-effects', 'blocks', npm('test:scroll-effects', browsers())],
  ['header-theme', 'blocks', npm('test:header-theme', browsers())],
  ['count-up', 'blocks', npm('test:count-up', browsers())],
  ['recipes', 'blocks', npm('test:recipes', browsers())],
  ['view-transitions', 'blocks', npm('test:view-transitions', browsers())],
  ['scrolly-steps', 'blocks', npm('test:scrolly-steps', browsers())],
  ['usegsap-teardown', 'blocks', npm('test:usegsap-teardown', browsers('chromium'))],
  ['folio-build', 'browsers', pnpm(folio, 'build'), needs(folio, 'examples/folio')],
  ['check:authority', 'browsers', pnpm(folio, 'check:authority', browsers()), needs(folio, 'examples/folio')],
  [
    'verify:scenes',
    'browsers',
    pnpm(folio, 'verify:scenes', browsers()),
    needs(folio, 'examples/folio') ?? (existsSync(join(folio, 'public', 'media')) ? null : 'no Folio media (pnpm media in examples/folio)'),
  ],
  ['site-build', 'site', pnpm(site, 'build'), needs(site, 'site')],
  ['site-check', 'site', pnpm(site, 'check'), needs(site, 'site')],
]

const GROUPS = { folio: ['folio-build', 'check:authority', 'verify:scenes'], site: ['site-build', 'site-check'] }
const skipped = new Set(args.skip.flatMap((g) => GROUPS[g] ?? [g]))

const rows = []
for (const [name, job, { cmd, argv, cwd }, missing] of STEPS) {
  if (args.only && !args.only.includes(name)) continue
  if (skipped.has(name)) {
    rows.push({ name, job, status: 'SKIP', detail: '--skip' })
    continue
  }
  // A Folio check needs its build: when the build failed, say so instead of running against a stale one.
  if (['check:authority', 'verify:scenes'].includes(name) && rows.some((r) => r.name === 'folio-build' && r.status === 'FAIL')) {
    rows.push({ name, job, status: 'SKIP', detail: 'folio-build failed' })
    continue
  }
  if (missing) {
    rows.push({ name, job, status: 'SKIP', detail: missing })
    console.log(`\n── ${name} (${job}): SKIP, ${missing}`)
    continue
  }
  console.log(`\n── ${name} (${job}): ${cmd} ${argv.join(' ')}${cwd === repo ? '' : `  [${cwd.slice(repo.length + 1)}]`}`)
  const t0 = Date.now()
  const run = spawnSync(cmd, argv, { cwd, stdio: 'inherit', env: process.env })
  const code = run.error ? `${run.error.code ?? run.error.message}` : run.status ?? run.signal
  rows.push({ name, job, status: code === 0 ? 'PASS' : 'FAIL', detail: `exit ${code} · ${Math.round((Date.now() - t0) / 1000)} s` })
}

console.log('\n── verify:all')
for (const r of rows) console.log(`${r.status.padEnd(4)}  ${r.job.padEnd(10)}  ${r.name.padEnd(17)}  ${r.detail}`)
const failed = rows.filter((r) => r.status === 'FAIL').length
const skippedCount = rows.filter((r) => r.status === 'SKIP').length
console.log(`\n${rows.length - failed - skippedCount} passed, ${failed} failed, ${skippedCount} skipped`)
process.exit(failed ? 1 : 0)
