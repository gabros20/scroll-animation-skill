# Agent guide — scroll-animation-skill

This repository packages one independently versioned runtime skill: `scroll-animation`. The GitHub
and plugin package name is `scroll-animation-skill`; the runtime identifier and Codex invocation
are `scroll-animation` and `$scroll-animation`. From v2 the same source ships the
`scroll-animation` CLI as the npm package `scroll-animation-cli`.

## Ownership boundary

`scroll-animation` owns motion tied to page arrival, scroll, media and a render loop on editorial
and creative websites: triggered entrances and text reveals, pinned scroll scenes, horizontal
rails, parallax and layered visuals, scrubbed and looping video, image sequences, page
transitions, smooth scroll (native, Lenis, ScrollSmoother) and scroll-driven Three.js/R3F, with
the performance, accessibility and verification work that motion needs.

It does not own UI micro-interactions (buttons, toasts, menus, hovers), layout scaling or
viewport-unit sizing, colour systems, or component libraries. Layout scaling on a fluid-design
project is fluid-design's; this skill reads its breakpoint, header height and units when present.

## Layout: runtime vs repository tooling

| Path | What | Ships in |
|---|---|---|
| `skills/scroll-animation/` | the runtime pack: `SKILL.md` (the router), `references/`, `agents/openai.yaml`, `assets/` (copy-and-own blocks), `scripts/tools/` (audit, verify, anchor check) | `install.sh`, `npx skills add`, npm from v2 |
| `scripts/` | the skill-family gate: `check-sync`, `lint-skill`, `count-skill-tokens`, `init`, `test-init` | nothing |
| `tests/` | typechecks, the GSAP smoke page, the scaled-travel distance check, audit fixtures | nothing |
| `evals/` | activation, traversal, output and compression-ablation fixtures | nothing |
| `docs/` | installation, usage, recipes, research and design records | nothing |

## Invariants

- **The runtime pack is self-contained.** Nothing under `skills/scroll-animation/` imports from
  `scripts/`, `tests/`, `evals/` or `docs/`, and no link in `SKILL.md` or a reference escapes the
  skill root. Repository-only features (the audit self-test) find their files from the repository
  and exit 2 with a clear message in an installed skill.
- **`SKILL.md` is the router.** Frontmatter is `name` and `description` only. Every reference is
  linked directly from it and opens with `Purpose`, `Read when`, `Skip when`, `Inputs`,
  `Produces`, with an early `## Contents` past 100 lines.
- **Versions agree.** `package.json`, `.codex-plugin/plugin.json` and the newest released
  `CHANGELOG.md` heading carry the same version. No version in `SKILL.md`.
- **Copy the prepared blocks; never rewrite them from memory.** They carry measured numbers and the
  reasons behind them.
- **Every command, flag, attribute and path in docs exists.** Check the code before writing one.

## Commands

```bash
npm ci
npm run verify        # scripts/check-sync, then npm test (types, audit self-test, GSAP smoke)
./install.sh claude   # install the runtime pack for Claude Code
```
