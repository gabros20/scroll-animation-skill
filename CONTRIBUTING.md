# Contributing

## Setup

```bash
npm ci
npx playwright install chromium
brew install ffmpeg   # or your platform's package; the smoke test encodes a test clip
```

## Checks

| Command | What it runs |
|---|---|
| `npm run check-sync` | the skill-family gate: pack lint (frontmatter, routes, reference headers, evals, metadata, versions) |
| `npm test` | engine typechecks, the audit self-test, the GSAP smoke page in Chromium |
| `npm run verify` | both, in that order |
| `npm run verify:all` | what CI runs: `verify`, every browser suite, the Folio checks and the storefront's (`-- --browsers chromium`, `--skip folio,site`, `--only rail`) |
| `scripts/count-skill-tokens` | token estimates per runtime file |

## Browser suites

- They share `tests/lib/harness.mjs`. Wait on a condition (`settle`, `until`, `scrollToProgress`, `frames`), never a
  guess: `npm run test:lint` rejects `waitForTimeout`, `sleep`/`wait`/`hold` and hand-built `setTimeout` sleeps. A
  wait about time itself (an observation window, input paced like a hand) takes a `fixed-wait: <reason>` comment.
- Where time is the subject, move a clock: Playwright's (`page.clock`) for timers and frames, `seekAnimations` for a
  CSS animation. Media stays on real time.
- No Playwright browsers installed? `HARNESS_CHROME=chrome npm run test:rail -- --browsers chromium` runs Chromium on
  the installed Google Chrome (or give an executable's path).

## Changing the pack

- Blocks under `skills/scroll-animation/assets/` are copied into projects as-is. Keep each file
  self-explanatory: the header states what it does, the DOM it expects and the reasons for its
  numbers.
- A new audit rule needs a `tests/fixtures/audit/<rule-id>/{positive,negative}` pair.
- Rename a reference and you must update `SKILL.md`'s route table and `evals/traversal/cases.json`.

## Releasing

The version lives in `package.json`, `.codex-plugin/plugin.json` and the newest `CHANGELOG.md`
heading; they must agree. Tag `v<version>` on `main` after the checks pass.
