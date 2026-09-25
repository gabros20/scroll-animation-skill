import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blocks",
  description: "The animation catalogue and fixture host for this skill.",
};

type Block = { name: string; body: string };
type Group = { clock: string; blocks: Block[] };

const GROUPS: Group[] = [
  {
    clock: "Foundation",
    blocks: [
      {
        name: "config, scale",
        body: "Queries, header var, scale presets and measured curves every other block reads.",
      },
      {
        name: "base-css",
        body: "Pre-JS gate, failsafe latch and the reduced-motion collapse, as plain CSS.",
      },
      { name: "gsap-setup", body: "Registers GSAP plugins once and sets shared defaults." },
      {
        name: "motion-provider",
        body: "Strict LazyMotion setup for Motion's `m` components.",
      },
      {
        name: "smooth-scroll",
        body: "Route-level Lenis or ScrollSmoother, Activity-safe.",
      },
    ],
  },
  {
    clock: "Trigger",
    blocks: [
      { name: "Reveal", body: "Fade, rise, clip or scale-in on arrival, once per element." },
      {
        name: "SplitWords",
        body: "Server-safe per-word split for an LCP-safe hero headline.",
      },
      { name: "split-reveal", body: "GSAP SplitText reveal for headlines below the fold." },
    ],
  },
  {
    clock: "Scroll",
    blocks: [
      {
        name: "scroll-effects",
        body: "Parallax, exit fade, progress bar and sticky stack, in CSS.",
      },
      {
        name: "PinnedScene",
        body: "The pinned-scene core: range, progress, bounds and latch.",
      },
      {
        name: "horizontal-rail",
        body: "A GSAP-driven horizontal gallery with a native scroll fallback.",
      },
      {
        name: "header-theme",
        body: "Flips header ink as the page crosses a dark section.",
      },
    ],
  },
  {
    clock: "Media",
    blocks: [
      {
        name: "ScrubVideo",
        body: "Scroll-scrubbed video: all-intra source, rVFC-driven seeks.",
      },
      {
        name: "FrameSequence",
        body: "Image-sequence playback with a decode window, not a memory bomb.",
      },
      {
        name: "LoopVideo",
        body: "An autoplaying loop with the pause control WCAG 2.2.2 requires.",
      },
    ],
  },
  {
    clock: "Route",
    blocks: [
      {
        name: "view-transitions",
        body: "Route and shared-element transitions, reduced-motion aware.",
      },
    ],
  },
  {
    clock: "Render",
    blocks: [
      {
        name: "ScrollCanvas",
        body: "A persistent, dynamically-imported R3F canvas with a poster fallback.",
      },
      {
        name: "camera-path",
        body: "Chapters-to-camera-moves along a Catmull-Rom spline.",
      },
    ],
  },
];

export default function BlocksPage() {
  return (
    <div className="px-6 py-20 sm:px-10 lg:py-28">
      <h1 className="font-display text-5xl tracking-tight lg:text-6xl">Blocks</h1>
      <p className="mt-4 max-w-xl font-sans text-lg text-ink-soft">
        The animation catalogue and fixture host for this skill. Not a design
        reference. Folio&rsquo;s own pages are.
      </p>
      <p className="mt-2 max-w-xl font-sans text-sm text-muted">
        Fixtures land here as each block ships. Right now this is the
        catalogue: what exists, grouped by clock, from the plan.
      </p>

      <div className="mt-16 space-y-16">
        {GROUPS.map((group) => (
          <section key={group.clock} aria-labelledby={`group-${group.clock}`}>
            <h2
              id={`group-${group.clock}`}
              className="font-sans text-sm tracking-[0.2em] text-muted uppercase"
            >
              {group.clock}
            </h2>
            <ul className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {group.blocks.map((block) => (
                <li key={block.name} className="border-t border-line pt-4">
                  <p className="font-display text-lg">{block.name}</p>
                  <p className="mt-1 font-sans text-sm text-muted">{block.body}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
