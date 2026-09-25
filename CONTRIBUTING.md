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
| `scripts/count-skill-tokens` | token estimates per runtime file |

## Changing the pack

- Blocks under `skills/scroll-animation/assets/` are copied into projects as-is. Keep each file
  self-explanatory: the header states what it does, the DOM it expects and the reasons for its
  numbers.
- A new audit rule needs a `tests/fixtures/audit/<rule-id>/{positive,negative}` pair.
- Rename a reference and you must update `SKILL.md`'s route table and `evals/traversal/cases.json`.

## Releasing

The version lives in `package.json`, `.codex-plugin/plugin.json` and the newest `CHANGELOG.md`
heading; they must agree. Tag `v<version>` on `main` after the checks pass.
