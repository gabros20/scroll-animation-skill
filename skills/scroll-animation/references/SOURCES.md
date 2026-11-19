# Sources

**Purpose:** Record the outside sources whose ideas shaped this pack, with each one's licence and what it informed.

**Read when:** someone asks where a rule or number came from, or whether a source's text may be reused; or a change
draws on a new outside source.
**Skip when:** doing motion work: no build decision depends on this file.

**Inputs:** the rule or number in question.
**Produces:** its origin and licence; a new row when a source is added.

Most of this pack was paid for by its own builds: the production site it was extracted from, the browser spikes
(S1–S11) and the device passes. Those need no row. Everything below is written in this pack's own words: no text or
code was copied. Permissive sources (MIT, Apache-2.0) were adapted; an unlicensed one only prompted a check.

## Design-fold sources (2026-11)

| Source | Licence | What it informed |
|---|---|---|
| `nateherkai/scroll-craft` | MIT | dead scroll, contrast over moving media, the slides, the device diagnostic, the layered hero and pointer depth, rail travel and clipped headings, the one-sided crossfade, the prime retry on activation and the stuck seek, the portrait mobile tier, footage preparation, the peak and the ending, a clip on tight type |
| `MengTo/skills` | MIT | path independence and jumps across scenes, gating CSS loops, the route-cycle probe, a preloader that keeps moving, the progress line through steps, wipe direction, particles, judging a canvas on the composed page, the per-frame lerp conversion |
| `emilkowalski/skills` | MIT | one entrance per container, the move varied by role, the fast reader's cost of a reveal on every section, Motion's accelerated transforms |
| `ibelick/motion-primitives` | MIT | a marquee's pace from a speed |
| `Leonxlnx/cinetic` | MIT | beats that overlap, the geometric zoom |
| `jpoindexter/typography-skills` | MIT | variable-font axes re-lay out the line |
| `jakubkrehel/skills` | MIT | `MotionConfig` still animates `filter` |
| `paper-design/shaders` | Apache-2.0 | releasing the WebGL context on unmount |
| `DevMartinese/awwwards-animations-skill` | none | prompted the Lenis `lerp`/`duration` check only; the rule comes from Lenis's source |

**Checked against primary sources**, where a fold rests on a fact: Playwright's release notes (1.57 bundles Chrome for
Testing), Motion's changelog (14.2.0, accelerated independent transforms), Lenis 1.3.26's source (a numeric `duration`
wins over `lerp`, the reverse of its README), three r186 (`dispose()` keeps the context; `forceContextLoss()` frees
it) and HTML's activation-triggering events (`touchend`, not `touchstart`).
