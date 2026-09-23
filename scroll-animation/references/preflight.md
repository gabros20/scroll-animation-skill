# Preflight: settle the motion decisions before any code

**Read when:** starting any animation task, greenfield or brownfield.
**Skip when:** a `MOTION.md` decision log already exists and the task stays inside its decisions.

Inspect the project first and ask second. Every question below has a default and a detection hint.
Ask only when detection is inconclusive **and** the answer changes the output. Put all the open
questions into one short batch; never ask one per turn. Record the answers in a short `MOTION.md` at
the project root (or in `FLUID.md` if the `fluid-design` skill already keeps one there): the engine,
the scene if there is one, the header behaviour, and what was decided about existing motion.

## Detection pass (about two minutes, read-only)

| Look at | Tells you |
|---|---|
| `package.json` deps | framework (next, astro, vite, remix, sveltekit, nuxt); `motion` or `framer-motion` (the same library under its old name); `gsap` (and whether `ScrollTrigger`, `SplitText` are imported); `lenis`, `@studio-freight/lenis`, `locomotive-scroll` |
| grep `ScrollTrigger.create\|scrollTrigger:` and `pin: true` | existing GSAP scroll work, and whether anything is pinned by GSAP rather than by CSS sticky |
| grep `new Lenis\|useLenis\|ReactLenis` | where smooth scroll is initialised and whether it is wired to GSAP's ticker |
| CSS: `scroll-behavior`, `overscroll-behavior`, `position: sticky`, `overflow-x: hidden` | page-wide smooth scroll (a scroll-well concern), sticky elements and the overflow trap that kills them |
| the header component | fixed or sticky? transparent or opaque? any scroll listener toggling classes, `transform`s (hide on scroll), or colours |
| `<video>` count, their attributes, file sizes | the playback work; whether any video is scrubbed; `ffprobe` any scrub candidate for its GOP |
| `fluid.config.json`, `--fluid` in the CSS | the page is on a fluid scale: read `fluid-interop.md` |
| existing entrance components (`FadeIn`, `Reveal`, `AOS`, `data-aos`) | a prior entrance system to keep, adapt or replace (§4) |

## The decisions

### 1. Animation engine

Default: **Motion (`motion/react`)** in React projects; **GSAP** otherwise, or when the user needs
timeline-heavy choreography, SplitText-quality line reveals, or already runs GSAP.

- Both engines ship the same primitives, attribute contract and measured curves
  (`assets/react-motion/`, `assets/gsap/`).
- One engine per element. GSAP may enter a Motion site as a scoped island for one section
  (`motion-architecture.md` §13).
- `framer-motion` in the deps is the same library; the primitives import `motion/react` (v12), so
  either add `motion` or rewrite the imports. Don't run both packages.
- **Lenis and other smooth-scroll hijacks: never add one.** Its lerp reshapes the native velocity
  curve that scroll-linked effects read, it breaks programmatic scroll locks, and on iOS touch it
  gains nothing (it leaves touch scrolling native by default). Smoothing belongs on effect outputs (a
  spring on a transform), never on the scrollbar. Tell the user this if they ask for it. **If the
  project already runs Lenis, that is a different question (§4)**: don't rip it out uninvited.
- Ask when: React is present and GSAP is also installed, or the user mentions timelines.

### 2. Scroll-driven scene

Default: **none**. Triggered entrances only.

- One per page at most. It needs an act structure and an all-intra video (or a canvas or image
  sequence): `video.md` §1. Ask only if the design shows pinned or scrubbed content.
- Ask for, or measure, the asset: is it all-intra? Does it loop at either end, and where are the
  seams? A scrub stuck on its first frame is very often a long-GOP asset.
- Settle the act count up front: N acts of one viewport give landmarks at 1/(N−1), so three acts
  give halves, not thirds (`scroll-scenes.md` §2).
- Ask whether any section in the scene should be pulled to rest (a scroll well), since that affects
  anchors and any existing smooth-scroll library.

### 3. Header behaviour

Default: a fixed, transparent header whose ink follows the section beneath it
(`data-header-theme`, `header-theme.md`).

- Ask when: the design shows an opaque header bar, or no header at all, or the header already has
  scroll behaviour (§4).

### 4. Existing motion: keep, adapt or replace

Only on a brownfield site that already animates. For each thing detected above (a header animation
or colour switcher, GSAP `ScrollTrigger` timelines, Lenis, an entrance library), the options are:

- **Keep**: leave it running untouched and build around it. Always the default for a header's
  existing colour or hide-on-scroll logic, and for Lenis the user wants kept.
- **Adapt**: keep it, but change the parts that conflict: route a scroll well through Lenis or turn
  the well off, replace hard-coded px `start`/`end` with functions, move a GSAP pin off an element
  that contains a sticky scene, feed the header's existing class from the probe.
- **Replace**: migrate it onto these primitives. Only when the user asks, or when the existing code
  is the bug being fixed.

`brownfield-coexistence.md` has the concrete conflicts and fixes for each. The one rule behind all of
them: **never run two writers on one property**.

### 5. The engage breakpoint source

Default: the fluid config's `engageAt` if one exists, otherwise the site's own desktop breakpoint
(`fluid-interop.md` §1). Not a question for the user unless the codebase has two candidates.

## Phrasing the questions

Batch them, give each its default, and let the user answer only the ones they care about:

> Before I set this up: (1) engine: Motion (you're on React) or GSAP? (2) any pinned or scrubbed
> video section? If so, is the clip all-intra? (3) header: keep your current transparent header and
> have its ink follow the section underneath? (4) you already run Lenis and a header colour script;
> I'd keep both and switch off the scroll well, which fights Lenis. OK? I'll go with the defaults if
> you don't mind.

For the existing-motion question, name what you found and propose the least invasive option; don't
present a menu of three for each item:

> I found GSAP ScrollTrigger timelines on `/about` (pinned with `pin: true`) and Lenis in the root
> layout. I'll keep both, keep your header's colour switching, and build the new hero with triggered
> entrances only. Say if you'd rather migrate any of them.

## Traps

- [ ] Detection ran before any question was asked.
- [ ] Questions went out as one batch, each with its default.
- [ ] No smooth-scroll library added; an existing one was not removed uninvited (§1, §4).
- [ ] At most one scroll scene, with its act count and asset settled (§2).
- [ ] Every existing motion system has a recorded keep / adapt / replace decision (§4).
- [ ] The decisions are written to `MOTION.md` (or `FLUID.md`).
