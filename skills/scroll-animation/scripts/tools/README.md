# scroll-animation scripts

Node 20+, ESM, zero runtime dependencies except `playwright` (needed by
`verify-motion.mjs` and `anchor-check.mjs`, resolved from the target
project — see below).

Layout/unit/render verification (overflow, drifted fluid units, one-screen
sections, grid columns) lives in the `fluid-design` skill's `fluid` command —
`fluid verify`, `fluid probe`, `fluid calc`, `fluid audit` (its `scripts/tools/`) — not here.

## audit-motion.mjs — static scanner

```
node audit-motion.mjs <srcDir> [--json]
node audit-motion.mjs --selftest
node audit-motion.mjs --help
```

Walks `<srcDir>` (skipping `node_modules`, `.git`, `.next`, `dist`, `build`)
and reports rule violations, each with a rule id, `file:line`, the offending
snippet, a one-line *why*, and a *fix*. Some rules need repo-wide context
(e.g. whether `LazyMotion strict` is present, whether `scroll-behavior:
smooth` is set anywhere, whether Lenis is a dependency) — that context is
computed once per scan root, over EVERY file including the `fluid-design`
skill's own generated output (`base.css` and friends, if that skill is also
installed), before per-file rules run. Generated files are then skipped by
the per-file rules themselves (scanning generated output for hand-authoring
mistakes is never meaningful) but still feed that shared context — a
generated base layer is a legitimate, common place `scroll-behavior: smooth`
gets set, so `scroll-well-vs-smooth-scroll` would never fire on that
recommended setup if generated files were dropped before context was built.

Rules (severity in parens): `motion-strict` (error — `motion.*` under
`LazyMotion strict`), `scroll-well-vs-smooth-scroll` (info — a scroll well
used alongside a page-wide `scroll-behavior: smooth`), `lenis-with-scroll-
well` (warn — Lenis alongside the scroll well; both are scroll-position
writers), `gsap-pin-with-sticky-scene` (error — a GSAP `pin: true` in the
same file as a `ScrubStage`/`data-scrub-stage`; the scene's pin is CSS
`position: sticky`, never nest it in a GSAP pin), `fractional-amount` (warn),
`contents-reveal` (error), `video-attrs` (warn), `fixed-travel-on-fluid` (warn — on a
fluid-scaled project, a GSAP `x`/`y` or ScrollTrigger `start`/`end` offset or a Motion
`useTransform` output typed as a plain number of 80+ px; drawn travel must scale,
`references/fluid-interop.md` §3).

`--selftest` runs the scanner over `fixtures/audit/<rule-id>/{positive,negative}`
for every rule and asserts each positive fixture trips the rule and each
negative fixture does not. `--json` prints `{ srcDir, findings }` instead of
the readable table.

Exit codes: `0` no error-severity findings, `1` at least one error-severity
finding, `2` usage error. `--selftest` exits `0`/`1` on pass/fail.

## verify-motion.mjs — the browser harness

```
node verify-motion.mjs <url> [--out dir] [--viewports 1440x900,390x844]
  [--reveal] [--scenes] [--anchors]
node verify-motion.mjs --help
```

With none of `--reveal`/`--scenes`/`--anchors` given, all three run. Drives
every `--viewports` WxH pair (a width `<= 480` is emulated as touch/mobile):

- **`--reveal`** — step-scrolls to the bottom using rAF + 200ms per step (a
  fast scroll outruns `IntersectionObserver` and gives false blanks), with
  `scroll-behavior` forced to `auto` for the duration (a page-wide `smooth`
  would otherwise have each step cancel the previous step's still-in-flight
  animation and the harness would stall partway down the page — measured:
  this made the check fail in every cell on a page with smooth scrolling
  on). Waits ~1.5s to let the contract's up-to-1.3s entrance transition
  settle, then reports every `[data-stage-item]` under opacity `0.99`.
- **`--scenes`** — for each `[data-scrub-stage]`, scrolls to *progress*
  (never a raw pixel offset — pixel offsets rot the moment content above the
  scene changes height) 0, .25, .5, .75 and 1, using `references/
  verification.md`'s maths (`top = stage.getBoundingClientRect().top +
  scrollY`, `range = stage.offsetHeight - innerHeight`, target `y = top +
  range * progress`), waits 2.5s per step for any glide/spring to settle,
  and records `data-motion-state` plus a screenshot at each step. A scene
  that never writes `data-motion-state` across any step fails the run — a
  machine that never transitions is either not wired up or has a broken
  threshold.
- **`--anchors`** — delegates to `anchor-check.mjs` with the same
  `--viewports` list (see below); its own exit code folds into this run's.

Writes `report.json` (every requested check, every viewport, for `--reveal`/
`--scenes`) plus screenshots under `--out`, and prints a readable summary
table. Playwright is resolved from the target project's `node_modules` first
(via `process.cwd()`, i.e. run this from inside the project), then a
skill-local install, then a clear install hint if neither exists.

Exit codes: `0` every requested check passed, `1` at least one failed, `2`
usage error or playwright could not be resolved/launched.

## anchor-check.mjs — the real-smooth-scroll anchor check

```
node anchor-check.mjs <url> [--selector 'a[href^="#"]']
  [--viewports 1440x900,390x844] [--limit 5] [--header-var --fluid-header-h]
  [--tolerance 2]
node anchor-check.mjs --help
```

`verify-motion.mjs --reveal` forces `document.documentElement.style.scrollBehavior = 'auto'` for the
duration of its own stepped `scrollTo` calls, which is the right call for a fast, deterministic
harness — but it means a green `--reveal` run proves nothing about whether a REAL anchor click
survives the page's actual `scroll-behavior: smooth` and any scroll well sitting between the click
and its target (`references/scroll-scenes.md` §8: an `instant`-writing scroll well cancels a smooth
scroll passing through it one rAF at a time unless it suspends itself). This script is the one check
that exercises that real path end to end. `verify-motion.mjs --anchors` delegates to it directly.

For each same-page anchor matching `--selector` (href starts with `#`, or its pathname/search match
the current page's and it carries a hash), up to `--limit` per viewport (default 5, `0` = no limit):
clicks it with the page's own `scroll-behavior` left alone, waits for `scrollend` or for `scrollY` to
sit unchanged for 300ms (10s cap), then asserts the target's landed `rect.top` is within
`--tolerance` px (default 2) of whichever offset mechanism it actually uses — `scroll-margin-top` (+
the root's `scroll-padding-top`), or the `--header-var` custom property (default `--fluid-header-h`, then the pre-namespace `--header-h`) read
as a fallback when the CSS ones are both zero. A viewport width `<= 480` is emulated as touch/mobile.

Exit codes: `0` every anchor in every viewport landed within tolerance, `1` at least one did not (or
an anchor/target went missing mid-check), `2` usage error or playwright could not be
resolved/launched. Playwright resolution matches `verify-motion.mjs`.

## fixtures/

- `fixtures/audit/<rule-id>/{positive,negative}/` — one isolated directory
  pair per audit rule, consumed by `audit-motion.mjs --selftest`.

`../../tests/` (repo root) is the runnable end-to-end validation for this
skill's assets — see its own `package.json`/`npm test`, which exercises
`assets/gsap`/`assets/react-motion` (`tsc --noEmit`), a Vite smoke page
against `verify-motion.mjs --reveal --scenes`, and `audit-motion.mjs
--selftest`.
