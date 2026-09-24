#!/usr/bin/env node
// audit-motion.mjs — static scanner for a scroll-animation codebase
// (greenfield or brownfield: existing GSAP/Lenis/header scripts). Every
// finding carries a rule id, file:line, the offending snippet, a one-line
// why, and a fix. This is a regex/heuristic scanner, not a type-checker: it
// is deliberately conservative (false negatives over false positives)
// because a noisy linter gets ignored.
//
// Usage:
//   node audit-motion.mjs [srcDir] [--json]
//   node audit-motion.mjs --selftest
//
// srcDir defaults to "." (the current directory / project root) -- walk()
// already skips node_modules, .git, .next, dist, build, .turbo, .cache and
// out, so running with no argument from a project root is the normal case,
// not just "src/".
//
// Exit codes: 0 = no error-severity findings, 1 = at least one error-severity
// finding, 2 = usage/invocation error.

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname_ = fileURLToPath(new URL('.', import.meta.url))

// ── CLI ─────────────────────────────────────────────────────────────────

const USAGE = `audit-motion.mjs — static scanner for a scroll-animation codebase (greenfield or brownfield).

Usage:
  node audit-motion.mjs [srcDir] [--json]
  node audit-motion.mjs --selftest

srcDir defaults to "." (a project root, not just "src/" -- walk() already
skips node_modules/.git/.next/dist/build/.turbo/.cache/out).

Options:
  --json          print { srcDir, findings } instead of the readable table
  --selftest      run every rule against fixtures/audit/<rule-id>/{positive,negative}
  -h, --help      print this message and exit

Exit codes: 0 = no error-severity findings, 1 = at least one error-severity
finding, 2 = usage/invocation error. --selftest exits 0/1 on pass/fail.`

function parseArgs(argv) {
  const out = { _: [], json: false, selftest: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--json') out.json = true
    else if (a === '--selftest') out.selftest = true
    else if (a.startsWith('--')) { console.error(`[audit-motion] unknown flag ${a}`); process.exit(2) }
    else out._.push(a)
  }
  return out
}

// ── file walking ────────────────────────────────────────────────────────

const SCAN_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.css', '.scss', '.html', '.vue', '.astro'])
const SKIP_DIR = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.cache', 'out'])

function walk(dir, acc = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.isFile() && SCAN_EXT.has(extname(e.name))) acc.push(p)
  }
  return acc
}

function lineOf(content, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++
  return line
}

function snippetAt(content, index, matchLen) {
  const start = content.lastIndexOf('\n', index) + 1
  let end = content.indexOf('\n', index + matchLen)
  if (end === -1) end = content.length
  return content.slice(start, end).trim().slice(0, 160)
}

// Blank out comments before any rule sees the content, so a rule pattern
// mentioned in prose (a `//` explainer, a JSX `{/* ... */}` aside, a CSS/JS
// docblock) never counts as a hit. Every masked character becomes a space
// EXCEPT newlines, which are kept as-is -- so `.length`, every index, and
// therefore every line number stay identical to the original. `//` and `/*`
// inside a string or template literal (a URL like `https://…`) are not
// comment starts: the state machine tracks string/template state and only
// treats `//`/`/*` as comments while in plain code.
//
// `blankStrings` (used for .css/.scss) also blanks the CONTENT of
// string/template literals, not just skips over it -- a rule pattern quoted
// inside an @error message string is otherwise readable to every rule
// below. This is deliberately NOT done for .tsx/.jsx/.html -- video-attrs
// needs to read attribute string content itself.
function maskComments(content, { blankStrings = false } = {}) {
  const chars = Array.from(content)
  const n = chars.length
  let i = 0
  let state = 'code' // code | line | block | sq | dq | tpl | html
  while (i < n) {
    const c = chars[i]
    const c2 = i + 1 < n ? chars[i + 1] : ''
    if (state === 'code') {
      if (c === '/' && c2 === '/') { chars[i] = ' '; chars[i + 1] = ' '; state = 'line'; i += 2; continue }
      if (c === '/' && c2 === '*') { chars[i] = ' '; chars[i + 1] = ' '; state = 'block'; i += 2; continue }
      if (c === '<' && chars.slice(i, i + 4).join('') === '<!--') {
        for (let k = 0; k < 4; k++) chars[i + k] = ' '
        state = 'html'
        i += 4
        continue
      }
      if (c === "'") { state = 'sq'; i++; continue }
      if (c === '"') { state = 'dq'; i++; continue }
      if (c === '`') { state = 'tpl'; i++; continue }
      i++
      continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; i++; continue }
      chars[i] = ' '
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { chars[i] = ' '; chars[i + 1] = ' '; state = 'code'; i += 2; continue }
      if (c !== '\n') chars[i] = ' '
      i++
      continue
    }
    if (state === 'html') {
      if (c === '-' && chars.slice(i, i + 3).join('') === '-->') {
        chars[i] = ' '; chars[i + 1] = ' '; chars[i + 2] = ' '; state = 'code'; i += 3; continue
      }
      if (c !== '\n') chars[i] = ' '
      i++
      continue
    }
    if (state === 'sq' || state === 'dq') {
      const quote = state === 'sq' ? "'" : '"'
      if (c === '\\') { if (blankStrings) { chars[i] = ' '; chars[i + 1] = ' ' } i += 2; continue }
      if (c === quote) { state = 'code'; i++; continue }
      if (c === '\n') { state = 'code'; i++; continue } // unterminated -- bail safely, don't eat the rest of the file
      if (blankStrings) chars[i] = ' '
      i++
      continue
    }
    if (state === 'tpl') {
      // Comments cannot start inside a template literal's static text, and we
      // don't attempt to parse `${...}` interpolations separately -- a `//`
      // or `/*` written inside one would be a very unusual thing to write and
      // is not worth the added state for.
      if (c === '\\') { if (blankStrings) { chars[i] = ' '; chars[i + 1] = ' ' } i += 2; continue }
      if (c === '`') { state = 'code'; i++; continue }
      if (blankStrings) chars[i] = ' '
      i++
      continue
    }
    i++
  }
  return chars.join('')
}

// ── repo-wide context (facts a single-file scan cannot know) ─────────────

function buildContext(files, contents) {
  let hasLazyMotionStrict = false
  let hasSmoothScrollBehavior = false
  let hasLenis = false
  let hasFluid = false

  for (const f of files) {
    const ext = extname(f)
    const c = contents.get(f)
    if (ext === '.css' || ext === '.scss') {
      // Anywhere, not just on html/:root -- scroll-behavior only meaningfully
      // applies to the scrolling root, and this skill's own motion.css
      // sets it there. False positives on an unrelated element's rule are
      // harmless: the finding below is informational, not an error.
      if (/scroll-behavior\s*:\s*smooth\b/.test(c)) hasSmoothScrollBehavior = true
    }
    if (/<LazyMotion\b[^>]*\bstrict\b/.test(c)) hasLazyMotionStrict = true
    if (/\bnew\s+Lenis\s*\(/.test(c) || /from\s+['"](?:@studio-freight\/)?lenis['"]/.test(c)) hasLenis = true
    // A fluid-scaled page: the fluid-design units or utilities anywhere.
    if (/var\(--fluid\b|\bfluid-(?:p|px|py|m|mt|mb|w|h|gap|display|copy|text|cap)-\d|\bfd\.fluid\(|\bfluid\(\s*\d/.test(c)) hasFluid = true
  }

  return { hasLazyMotionStrict, hasSmoothScrollBehavior, hasLenis, hasFluid }
}

// ── rule helpers ────────────────────────────────────────────────────────

function pushFinding(acc, { rule, file, content, index, matchLen, severity, why, fix }) {
  acc.push({
    rule,
    file,
    line: lineOf(content, index),
    snippet: snippetAt(content, index, matchLen),
    severity,
    why,
    fix
  })
}

// Extract top-level JSX-ish tags (from `<Tag` to its `>`), non-nesting, for
// rules that need "does this one opening tag carry both X and Y".
function extractTags(content) {
  const out = []
  const re = /<[A-Za-z][\w.]*(?:\s[^<>]*?)?\/?>/g
  let m
  while ((m = re.exec(content))) out.push({ text: m[0], index: m.index })
  return out
}

// ── rules ───────────────────────────────────────────────────────────────
// Each rule: { id, ext: (extname)=>bool, run(content, file, ctx, acc, opts) }

const rules = [
  {
    id: 'motion-strict',
    ext: (e) => ['.tsx', '.jsx'].includes(e),
    run(content, file, ctx, acc) {
      if (!ctx.hasLazyMotionStrict) return
      const re = /\bmotion\.[a-z]+/g
      let m
      while ((m = re.exec(content))) {
        pushFinding(acc, {
          rule: this.id, file, content, index: m.index, matchLen: m[0].length, severity: 'error',
          why: 'LazyMotion with strict is present in this project. Under strict mode, motion.* throws at runtime — only the m namespace is permitted.',
          fix: `Import m from motion/react and use m.${m[0].split('.')[1]} instead of ${m[0]}.`
        })
      }
    }
  },

  {
    // A page-wide `scroll-behavior: smooth` (motion.css sets this on
    // `html` by default) means the scroll well's own per-frame
    // `behavior: 'instant'` writes cancel any smooth scroll passing through
    // its target one rAF at a time -- an anchor click that should land 900px
    // further away instead stalls at the well (references/scroll-scenes.md
    // §8; `verify-motion.mjs --reveal` failed in every cell this way on a
    // real build). Both engines' scrollPull now suspend automatically on a
    // same-page hash click/hashchange, and expose `suspend(ms)` for a
    // caller driving its own programmatic scroll -- this rule is
    // informational, not an error, as a reminder to call it for any OTHER
    // kind of scroll (a router push, an imperative scrollIntoView outside a
    // click handler) that would not be caught by those two listeners.
    id: 'scroll-well-vs-smooth-scroll',
    ext: (e) => ['.tsx', '.jsx', '.vue', '.astro', '.html'].includes(e),
    run(content, file, ctx, acc) {
      if (!ctx.hasSmoothScrollBehavior) return
      const re = /<PullToCentre\b|\bdata-pull-to-centre\b|\bcreateScrollPull\s*\(|\binitPullToCentre\s*\(/g
      let m
      while ((m = re.exec(content))) {
        pushFinding(acc, {
          rule: this.id, file, content, index: m.index, matchLen: m[0].length, severity: 'info',
          why: 'This project sets scroll-behavior: smooth somewhere and also uses a scroll well (PullToCentre/scrollPull). The well auto-suspends for a same-page hash click and hashchange, but any OTHER programmatic/smooth scroll (a router navigation, an imperative scrollIntoView outside a click handler) that passes through the well\'s target will still be cancelled one rAF at a time unless you call suspend() around it (references/scroll-scenes.md §8).',
          fix: 'Call the returned controller\'s suspend(ms) immediately before driving any scroll of your own through this target, or confirm the only programmatic scrolls in this tree are same-page hash clicks/hashchange, which are already covered automatically.'
        })
      }
    }
  },

  {
    // Lenis and the scroll well (PullToCentre/scrollPull) are both scroll-
    // position writers. Lenis intercepts the wheel/touch input and drives
    // its own smoothed scroll; the well reads scroll position every rAF and
    // writes `window.scrollTo(..., { behavior: 'instant' })` toward its
    // target. Running both unmodified means two systems fighting for the
    // same property -- the well's writes fight Lenis's interpolation, and
    // Lenis's own smoothing means the well's distance/velocity reads (tuned
    // against native scroll) are off. See brownfield-coexistence.md: keep
    // Lenis if wanted, but either disable it for the well's range or route
    // the well's writes through `lenis.scrollTo` instead of raw
    // `window.scrollTo`.
    id: 'lenis-with-scroll-well',
    ext: (e) => ['.tsx', '.jsx', '.vue', '.astro', '.html'].includes(e),
    run(content, file, ctx, acc) {
      if (!ctx.hasLenis) return
      const re = /<PullToCentre\b|\bdata-pull-to-centre\b|\bcreateScrollPull\s*\(|\binitPullToCentre\s*\(/g
      let m
      while ((m = re.exec(content))) {
        pushFinding(acc, {
          rule: this.id, file, content, index: m.index, matchLen: m[0].length, severity: 'warn',
          why: 'This project depends on Lenis somewhere and also uses the scroll well (PullToCentre/scrollPull). Both are scroll-position writers; left unmodified they fight each other for the same property (references/brownfield-coexistence.md).',
          fix: 'Disable Lenis over the well\'s range, or route the well through lenis.scrollTo instead of the native scrollTo it uses by default -- never run both unmodified over the same target.'
        })
      }
    }
  },

  {
    // A GSAP `ScrollTrigger.create({ pin: true, ... })` (or `gsap.timeline({
    // scrollTrigger: { pin: true } })`) creates its OWN pin-spacer element
    // and reparents the pinned content into it. ScrubStage's pin is a plain
    // CSS `position: sticky` element, not a ScrollTrigger pin -- nesting the
    // scene inside a GSAP pin means the scene's sticky geometry resolves
    // against the pin-spacer's scroll container, not the page, and the two
    // systems' idea of "current scroll progress" drift apart (references/
    // brownfield-coexistence.md: "never nest the scene in a GSAP pin"). This
    // rule is a same-file heuristic -- it cannot see whether the pin
    // TARGETS the scene's ancestor, only that both exist in one file, which
    // is the common case for a single-page hero/scene component.
    id: 'gsap-pin-with-sticky-scene',
    ext: (e) => ['.ts', '.tsx', '.js', '.jsx'].includes(e),
    run(content, file, ctx, acc) {
      if (!/\bdata-scrub-stage\b|<ScrubStage\b/.test(content)) return
      const re = /\bpin\s*:\s*true\b/g
      let m
      while ((m = re.exec(content))) {
        pushFinding(acc, {
          rule: this.id, file, content, index: m.index, matchLen: m[0].length, severity: 'error',
          why: 'This file has a GSAP pin: true alongside a ScrubStage scene (data-scrub-stage/<ScrubStage>). The scene\'s pin is CSS position: sticky, not a ScrollTrigger pin -- nesting it inside a GSAP pin-spacer breaks both systems\' scroll-progress maths (references/brownfield-coexistence.md).',
          fix: 'Make sure this pin: true does not target an ancestor of the scrub scene. If the pinned element and the scene are unrelated, scope them clearly (e.g. separate files/components) so this heuristic stops flagging the coincidence.'
        })
      }
    }
  },

  {
    // On a fluid-scaled page the composition is 1.6x larger at 2560x1440
    // than at the 1440x900 reference, so a drawn travel distance typed as a
    // plain number (`x: 600`, `end: '+=1800'`, a useTransform output of 600)
    // lands short on big screens and overshoots on small ones. Entrance
    // offsets of 24-40px stay fixed on purpose, so only |n| >= 80 is flagged
    // (references/fluid-interop.md §3).
    id: 'fixed-travel-on-fluid',
    ext: (e) => ['.ts', '.tsx', '.js', '.jsx'].includes(e),
    run(content, file, ctx, acc) {
      if (!ctx.hasFluid) return
      const why = 'This project is on a fluid scale, and this drawn travel distance is a fixed number. It is right at the 1440x900 reference and wrong everywhere else (1.6x too short at 2560x1440). Small entrance offsets (24-40px) may stay fixed; travel scales (references/fluid-interop.md §3).'
      const checks = [
        // GSAP tween vars: x: 600 / y: -240 (not xPercent/yPercent)
        { re: /\b(?:x|y)\s*:\s*(-?\d+(?:\.\d+)?)(?![\w%.])/g, n: 1, fix: 'Use x: fluidValue(N) (assets/gsap/src/fluid.ts) with invalidateOnRefresh: true, or tween --scene-p and let CSS multiply: translate: calc(var(--scene-p) * N * var(--fluid)) 0.' },
        // ScrollTrigger end/start offsets: '+=1800', 'top top+=120'
        { re: /\b(?:end|start)\s*:\s*['"`][^'"`]*?[+-]=\s*(\d+)(?!\s*%)[^'"`]*['"`]/g, n: 1, fix: 'Use end: fluidEnd(N), or a function: start: () => `top top+=${fluidPx(N)}`, with invalidateOnRefresh: true.' },
        // Motion useTransform output range with a big literal
        { re: /useTransform\([^)]*?\[[^\]]*\]\s*,\s*\[([^\]]*)\]/g, n: 1, list: true, fix: 'Map progress to a unitless 0..1 and multiply by the unit: useTransform(() => p.get() * N * f.get()) with f = useFluidUnit(), or write --scene-p and let CSS multiply.' }
      ]
      for (const c of checks) {
        let m
        while ((m = c.re.exec(content))) {
          const nums = c.list ? (m[c.n].match(/-?\d+(?:\.\d+)?(?![\w%.])/g) ?? []).map(Number) : [Number(m[c.n])]
          if (!nums.some((n) => Math.abs(n) >= 80)) continue
          pushFinding(acc, { rule: this.id, file, content, index: m.index, matchLen: m[0].length, severity: 'warn', why, fix: c.fix })
        }
      }
    }
  },

  {
    id: 'fractional-amount',
    ext: (e) => ['.tsx', '.jsx'].includes(e),
    run(content, file, ctx, acc) {
      const blockRe = /\b(whileInView|viewport)\s*=\s*\{\{([^]*?)\}\}/g
      let bm
      while ((bm = blockRe.exec(content))) {
        const amountRe = /amount\s*:\s*0?\.\d+/g
        let am
        while ((am = amountRe.exec(bm[2]))) {
          const index = bm.index + bm[0].indexOf(am[0], bm[1].length)
          pushFinding(acc, {
            rule: this.id, file, content, index, matchLen: am[0].length, severity: 'warn',
            why: 'A fractional viewport.amount is unsatisfiable once the element is taller than the viewport — the trigger can never see that fraction of the element at once, so it never fires on tall content (motion-architecture.md §8).',
            fix: 'Use amount: "some" for a coarse trigger, or drive the reveal from a margin-based rootMargin instead of a fraction.'
          })
        }
      }
    }
  },

  {
    id: 'contents-reveal',
    ext: (e) => ['.tsx', '.jsx', '.css', '.scss'].includes(e),
    run(content, file, ctx, acc) {
      const ext = extname(file)
      if (ext === '.css' || ext === '.scss') {
        const re = /display\s*:\s*contents\b/g
        let m
        while ((m = re.exec(content))) {
          pushFinding(acc, {
            rule: this.id, file, content, index: m.index, matchLen: m[0].length, severity: 'error',
            why: 'display: contents generates no box, so IntersectionObserver has nothing to observe. If the element carrying this rule also has whileInView, data-stage or is a Stage, its reveal never fires (motion-architecture.md §8).',
            fix: 'Give the element a real box (e.g. display: flex/block) or move the reveal trigger to an ancestor that does generate one.'
          })
        }
        return
      }
      for (const tag of extractTags(content)) {
        const hasContents = /\bcontents\b/.test(tag.text) && /className\s*=/.test(tag.text)
        if (!hasContents) continue
        const hasTrigger = /whileInView|data-stage\b|<Stage\b/.test(tag.text)
        if (!hasTrigger) continue
        pushFinding(acc, {
          rule: this.id, file, content, index: tag.index, matchLen: tag.text.length, severity: 'error',
          why: 'This element carries a contents class alongside a reveal trigger (whileInView/data-stage/Stage). display: contents generates no box, so the trigger never fires — a whole stat grid has shipped stuck at opacity 0 this way.',
          fix: 'Drop contents from this element, or move whileInView/data-stage to a wrapping element that keeps a real box.'
        })
      }
    }
  },

  {
    id: 'video-attrs',
    ext: (e) => ['.tsx', '.jsx', '.vue', '.astro', '.html'].includes(e),
    run(content, file, ctx, acc) {
      const re = /<video\b[^>]*>/gi
      let m
      while ((m = re.exec(content))) {
        const tag = m[0]
        const missing = []
        if (!/\bmuted\b/.test(tag)) missing.push('muted')
        if (!/\bplaysInline\b/i.test(tag)) missing.push('playsInline')
        if (!/\bpreload\s*=/.test(tag)) missing.push('preload')
        if (missing.length === 0) continue
        pushFinding(acc, {
          rule: this.id, file, content, index: m.index, matchLen: m[0].length, severity: 'warn',
          why: `Missing ${missing.join(', ')}. Autoplay/scrub video needs all three to behave consistently across browsers (muted+playsInline for iOS autoplay, preload to control initial buffering).`,
          fix: `Add the missing attribute(s): ${missing.join(', ')}.`
        })
      }
    }
  }
]

// ── engine ──────────────────────────────────────────────────────────────

// Any file whose header carries both these words is the fluid-design
// skill's OWN generator output (`generate-fluid.mjs`'s cssHeader/
// scssHeader/tsHeader, e.g. "GENERATED by fluid-design's generate-
// fluid.mjs"). A project that also has the fluid-design skill installed may
// have this generated output sitting alongside hand-authored motion code,
// and none of the rules above are meaningful against it. Exempt from every
// PER-FILE rule below. Checked against a prefix of the RAW file, before any
// masking.
//
// It still feeds buildContext(): buildContext computes repo-wide FACTS (is
// `scroll-behavior: smooth` set anywhere, is LazyMotion strict present, is
// Lenis a dependency, ...), and fluid-design's own generated base layer is
// a legitimate, common place `scroll-behavior: smooth` gets set. Filtering
// generated files out before buildContext ran would mean `scroll-well-vs-
// smooth-scroll` could never fire on that skill's recommended setup
// (generated base layer + <PullToCentre>/data-pull-to-centre elsewhere).
// Generated files are excluded from the PER-FILE loop only; buildContext
// always sees every file.
const GENERATED_HEADER_RE = /generated/i
const GENERATED_SKILL_RE = /fluid-design/i
function isGeneratedFile(raw) {
  const head = raw.slice(0, 400)
  return GENERATED_HEADER_RE.test(head) && GENERATED_SKILL_RE.test(head)
}

export function scan(srcDir) {
  const files = walk(srcDir)
  const raw = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))
  const generated = new Map(files.map((f) => [f, isGeneratedFile(raw.get(f))]))
  // Every rule sees comments blanked out (newlines preserved, so line numbers
  // are unaffected) -- a rule pattern mentioned in a docblock or JSX aside
  // must never count as a hit. Repo-wide context is built from the same
  // masked text, so a commented-out LazyMotion/Lenis/scroll-behavior line
  // doesn't count either. .css/.scss additionally blank STRING CONTENT (not
  // just skip over it) -- see maskComments' docblock.
  const contents = new Map(
    files.map((f) => {
      const ext = extname(f)
      const blankStrings = ext === '.css' || ext === '.scss'
      return [f, maskComments(raw.get(f), { blankStrings })]
    })
  )
  // buildContext runs over ALL files, generated included -- see the docblock
  // above isGeneratedFile.
  const ctx = buildContext(files, contents)

  const findings = []
  for (const file of files) {
    if (generated.get(file)) continue
    const ext = extname(file)
    const content = contents.get(file)
    for (const rule of rules) {
      if (!rule.ext(ext)) continue
      rule.run(content, file, ctx, findings)
    }
  }
  return findings
}

// ── output ──────────────────────────────────────────────────────────────

function printTable(findings, root) {
  if (findings.length === 0) {
    console.log('audit-motion: no findings.')
    return
  }
  const order = { error: 0, warn: 1, info: 2 }
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line)
  for (const f of sorted) {
    const loc = `${relative(root, f.file)}:${f.line}`
    console.log(`[${f.severity.toUpperCase()}] ${f.rule}  ${loc}`)
    console.log(`  ${f.snippet}`)
    console.log(`  why: ${f.why}`)
    console.log(`  fix: ${f.fix}`)
    console.log('')
  }
  const counts = { error: 0, warn: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  console.log(`${findings.length} finding(s) — ${counts.error} error, ${counts.warn} warn, ${counts.info} info.`)
}

// ── selftest ────────────────────────────────────────────────────────────

function selftest() {
  const fixturesRoot = join(__dirname_, 'fixtures', 'audit')
  let pass = 0
  let fail = 0
  let caseCount = 0
  for (const rule of rules) {
    const ruleDir = join(fixturesRoot, rule.id)
    let entries
    try {
      entries = readdirSync(ruleDir, { withFileTypes: true }).filter((e) => e.isDirectory())
    } catch {
      entries = []
    }
    // Every subdirectory whose name starts with "positive" or "negative" is
    // its own isolated scan root (its own repo-wide context), which lets a
    // rule that needs more than one negative case -- e.g. "no Lenis
    // dependency" vs "Lenis present but no scroll well" -- test them
    // independently instead of one polarity masking the other.
    const cases = entries
      .map((e) => e.name)
      .filter((name) => name.startsWith('positive') || name.startsWith('negative'))
      .sort()
    if (cases.length === 0) {
      console.error(`[selftest] MISSING fixture dirs under: ${relative(fixturesRoot, ruleDir)}`)
      fail++
      continue
    }
    for (const name of cases) {
      caseCount++
      const dir = join(ruleDir, name)
      const findings = scan(dir)
      const hit = findings.some((f) => f.rule === rule.id)
      const expected = name.startsWith('positive')
      if (hit === expected) {
        pass++
      } else {
        fail++
        console.error(`[selftest] FAIL ${rule.id}/${name}: expected ${expected ? 'a hit' : 'no hit'}, got ${hit ? 'a hit' : 'no hit'}`)
      }
    }
  }
  console.log(`[selftest] ${pass} passed, ${fail} failed (${caseCount} cases across ${rules.length} rules).`)
  return fail === 0
}

// ── main ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(USAGE)
    process.exit(0)
  }

  if (args.selftest) {
    const ok = selftest()
    process.exit(ok ? 0 : 1)
  }

  // Default to the current directory -- a PROJECT ROOT, not a src/ folder --
  // now that walk()'s SKIP_DIR already excludes node_modules/.git/.next/
  // dist/build/.turbo/.cache/out.
  const srcDir = args._[0] ?? '.'

  const findings = scan(srcDir)

  if (args.json) {
    console.log(JSON.stringify({ srcDir, findings }, null, 2))
  } else {
    printTable(findings, srcDir)
  }

  const hasError = findings.some((f) => f.severity === 'error')
  process.exit(hasError ? 1 : 0)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(2)
  })
}
