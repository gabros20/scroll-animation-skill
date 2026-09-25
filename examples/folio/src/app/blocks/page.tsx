import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MediaSlot } from "@/components/media-slot";
import { getJournalArticle } from "@/content/journal";
import { mediaExists, mediaSrc } from "@/lib/media";
import { ScrubScene, SequenceScene } from "./fixtures";

export const metadata: Metadata = {
  title: "Blocks",
  description:
    "The animation catalogue and fixture host for this skill. Not a design reference.",
};

/** `fixture`: the id of the fixture below that runs the block. */
type Block = { name: string; body: string; fixture?: string };
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
        fixture: "fixture-frame-sequence",
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
        fixture: "fixture-scrub-video",
      },
      {
        name: "FrameSequence",
        body: "Image-sequence playback with a decode window, not a memory bomb.",
        fixture: "fixture-frame-sequence",
      },
      {
        name: "LoopVideo",
        body: "An autoplaying loop with the pause control WCAG 2.2.2 requires.",
        fixture: "fixture-loop-video",
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

function Fixture({
  id,
  name,
  note,
  children,
}: {
  id: string;
  name: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-16 border-t border-line pt-10">
      <div className="px-6 sm:px-10">
        <h3 id={`${id}-heading`} className="font-display text-2xl">
          {name}
        </h3>
        <p className="mt-2 max-w-xl font-sans text-sm text-muted">{note}</p>
      </div>
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Pending() {
  return (
    <p className="px-6 font-sans text-sm text-muted sm:px-10">
      Media pending: run <code>pnpm media</code>, then build again.
    </p>
  );
}

export default function BlocksPage() {
  const loop = getJournalArticle("what-rust-is-for")?.loop;

  return (
    <>
      <div className="px-6 py-20 sm:px-10 lg:py-28">
        <p className="font-sans text-sm tracking-[0.2em] text-muted uppercase">
          Not a design reference
        </p>
        <h1 className="mt-4 font-display text-5xl tracking-tight lg:text-6xl">Blocks</h1>
        <p className="mt-4 max-w-xl font-sans text-lg text-ink-soft">
          The animation catalogue and fixture host for this skill. Folio&rsquo;s own
          pages are the design reference; nothing here is styled to be looked at.
        </p>
        <p className="mt-2 max-w-xl font-sans text-sm text-muted">
          The catalogue lists every block in the plan, grouped by clock. The media
          blocks that have shipped run below it as fixtures, on their defaults.
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
                    {block.fixture ? (
                      <a
                        href={`#${block.fixture}`}
                        className="mt-2 inline-block font-sans text-sm text-accent hover:underline"
                      >
                        Fixture below
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <section aria-labelledby="fixtures-heading" className="pb-20 lg:pb-28">
        <h2
          id="fixtures-heading"
          className="px-6 font-sans text-sm tracking-[0.2em] text-muted uppercase sm:px-10"
        >
          Fixtures
        </h2>

        <Fixture
          id="fixture-frame-sequence"
          name="FrameSequence on PinnedScene"
          note="Motion. The camera's turn as 120 WebP frames (blocks/camera-sequence, 1600 px wide, or 900 px on narrow screens), decoded in a window around the frame on screen. The scene's band picks the frame; reduced motion shows the first."
        >
          {mediaExists("blocks/camera-sequence/manifest.json") ? (
            <SequenceScene
              manifest={mediaSrc("blocks/camera-sequence/manifest.json")}
              label="An antique folding camera on a wooden tripod, turning through one full circle."
            />
          ) : (
            <Pending />
          )}
        </Fixture>

        <Fixture
          id="fixture-scrub-video"
          name="ScrubVideo"
          note="Motion. The clip the home page scrubs with GSAP: 240 all-intra frames, 1920 or 1080 wide by the desktop query, holding its first and last frames. Reduced motion holds the first."
        >
          {mediaExists("hero/scrub-camera-1920.mp4") ? (
            <ScrubScene
              src={mediaSrc("hero/scrub-camera-1920.mp4")}
              mobileSrc={mediaSrc("hero/scrub-camera-1080.mp4")}
              poster={mediaSrc("hero/scrub-camera-poster.avif")}
            />
          ) : (
            <Pending />
          )}
        </Fixture>

        <Fixture
          id="fixture-loop-video"
          name="LoopVideo"
          note="Motion. The rust loop from the journal: it plays in view and pauses out of it, and under reduced motion or Save-Data it waits for the button."
        >
          {loop ? (
            <div className="max-w-3xl px-6 sm:px-10">
              <MediaSlot
                kind="loop"
                src={loop.src}
                poster={loop.poster}
                alt={loop.alt}
                width={loop.width}
                height={loop.height}
                className="rounded-sm"
              />
            </div>
          ) : null}
        </Fixture>
      </section>
    </>
  );
}
