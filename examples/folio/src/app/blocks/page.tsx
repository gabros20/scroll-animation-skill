import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CountUp } from "@/animation/motion/CountUp";
import { Reveal, RevealItem, type RevealEffect } from "@/animation/motion/Reveal";
import { SplitWords } from "@/animation/motion/SplitWords";
import { MediaSlot } from "@/components/media-slot";
import { Rail } from "@/components/rail";
import { getJournalArticle } from "@/content/journal";
import { folioObjects } from "@/content/objects";
import { mediaExists, mediaSrc } from "@/lib/media";
import { MarqueeToggle, ScrubScene, SequenceScene } from "./fixtures";

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
      {
        name: "Reveal",
        body: "Fade, rise, clip or scale-in on arrival, once per element.",
        fixture: "fixture-reveal",
      },
      {
        name: "SplitWords",
        body: "Server-safe per-word split for an LCP-safe hero headline.",
        fixture: "fixture-split-words",
      },
      { name: "split-reveal", body: "GSAP SplitText reveal for headlines below the fold." },
      {
        name: "CountUp",
        body: "A number that counts up once as it arrives; the server renders the final value.",
        fixture: "fixture-count-up",
      },
    ],
  },
  {
    clock: "Scroll",
    blocks: [
      {
        name: "scroll-effects",
        body: "Parallax, fade and scale in, exit fade, a progress bar, a sticky stack and a marquee, in CSS.",
        fixture: "fixture-scroll-effects",
      },
      {
        name: "PinnedScene",
        body: "The pinned-scene core: range, progress, bounds and latch.",
        fixture: "fixture-frame-sequence",
      },
      {
        name: "horizontal-rail",
        body: "A GSAP-driven horizontal gallery with a native scroll fallback.",
        fixture: "fixture-rail",
      },
      {
        name: "header-theme",
        body: "Flips header ink as the page crosses a dark section.",
        fixture: "fixture-header-theme",
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

const REVEAL_EFFECTS: RevealEffect[] = ["rise", "fade", "clip", "scale-in"];

const COUNTS = [
  { label: "Defaults", count: <CountUp to={1280} /> },
  { label: "Fraction digits from `to`", count: <CountUp to={98.6} /> },
  {
    label: "A year: from 1990, no grouping",
    count: <CountUp from={1990} to={2026} format={{ grouping: false }} />,
  },
  { label: "Locale de-DE", count: <CountUp to={12500.75} format={{ locale: "de-DE" }} /> },
];

const STACK_CARDS = ["First card", "Second card", "Third card"];

const RAIL_PANELS = ["One", "Two", "Three", "Four", "Five", "Six"];

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
          The catalogue lists every block in the plan, grouped by clock. The blocks
          that have shipped run below it as fixtures, on their defaults.
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
          id="fixture-reveal"
          name="Reveal"
          note="Motion. One group, one item per effect, staggered in document order once the group's top crosses 80% of the viewport. With JavaScript off or reduced motion, everything is at rest from the first paint."
        >
          <Reveal className="grid gap-6 px-6 sm:grid-cols-2 sm:px-10 lg:grid-cols-4">
            {REVEAL_EFFECTS.map((effect) => (
              <RevealItem
                key={effect}
                effect={effect}
                className="flex h-40 items-end bg-paper-raised p-4 font-sans text-sm"
              >
                {effect}
              </RevealItem>
            ))}
          </Reveal>
        </Fixture>

        <Fixture
          id="fixture-split-words"
          name="SplitWords"
          note="Split on the server and risen by CSS from the first frame, with no JavaScript. It is made for the hero, so down here it has finished before you arrive: reload with it in view. The second line is Japanese, split at Intl.Segmenter's word boundaries on the server."
        >
          <div className="px-6 sm:px-10">
            <SplitWords
              as="p"
              text="Every line arrives when its reader does."
              className="max-w-3xl font-display text-4xl leading-tight"
            />
            <div lang="ja">
              <SplitWords as="p" locale="ja" text="吾輩は猫である。名前はまだ無い。" className="mt-6 text-2xl" />
            </div>
          </div>
        </Fixture>

        <Fixture
          id="fixture-count-up"
          name="CountUp"
          note="Motion. The server renders each final value; the count rewinds to its start once about 60% of the number is visible and plays once. Screen readers hear the final value, and reduced motion shows it at once."
        >
          <dl className="grid gap-8 px-6 sm:grid-cols-2 sm:px-10 lg:grid-cols-4">
            {COUNTS.map(({ label, count }) => (
              <div key={label}>
                <dt className="font-sans text-sm text-muted">{label}</dt>
                <dd className="mt-2 font-display text-5xl tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
        </Fixture>

        <Fixture
          id="fixture-scroll-effects"
          name="scroll-effects"
          note="CSS on scroll and view timelines (Chromium, Safari 26), each element opted in with data-scroll-fx on its defaults: parallax inside a clipping frame, fade-in, scale-in and exit-fade, then a sticky stack. Firefox, reduced motion and print show the finished state, and the stack still sticks. The marquee runs on time, not scroll, so it has a pause button."
        >
          <div className="grid gap-6 px-6 sm:grid-cols-2 sm:px-10 lg:grid-cols-4">
            <div className="relative h-72 overflow-clip bg-paper-raised">
              <MediaSlot
                kind="image"
                src="objects/glass-shade.avif"
                alt="A hand-blown glass lamp shade."
                width={640}
                height={800}
                fx="parallax"
                className="absolute inset-x-0 -top-15 h-[calc(100%+7.5rem)] w-full object-cover"
              />
              <p className="absolute bottom-3 left-3 rounded-full bg-ink px-3 py-1 font-sans text-xs text-paper">
                parallax
              </p>
            </div>
            {["fade-in", "scale-in", "exit-fade"].map((effect) => (
              <div
                key={effect}
                data-scroll-fx={effect}
                className="flex h-72 items-end bg-paper-raised p-4 font-sans text-sm"
              >
                {effect}
              </div>
            ))}
          </div>
          <ol data-scroll-fx="sticky-stack" className="mt-16 px-6 sm:px-10">
            {STACK_CARDS.map((card) => (
              <li
                key={card}
                className="flex h-[50svh] items-end border border-line bg-paper-raised p-6 font-sans text-sm"
              >
                sticky-stack: {card.toLowerCase()}
              </li>
            ))}
          </ol>
          <div className="mt-16 px-6 sm:px-10">
            <MarqueeToggle controls="fixture-marquee" />
          </div>
          <div data-scroll-fx="marquee" id="fixture-marquee" className="mt-4">
            <div>
              {[false, true].map((copy) => (
                <ul
                  key={String(copy)}
                  aria-hidden={copy || undefined}
                  inert={copy || undefined}
                  className="flex gap-12 pe-12 font-display text-3xl whitespace-nowrap"
                >
                  {folioObjects.map((object) => (
                    <li key={object.name}>{object.name}</li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </Fixture>

        <Fixture
          id="fixture-rail"
          name="horizontal-rail"
          note="GSAP, on pinned-scene's default holds. The runway is the measured travel, so the track moves one pixel per pixel of scroll between the holds. Reduced motion: no pin, no runway, and the track is a native horizontal snap scroller."
        >
          <Rail
            labelledBy="fixture-rail-heading"
            trackClassName="items-center scroll-px-6 px-6 pt-(--header-h) sm:scroll-px-10 sm:px-10"
          >
            <ul className="flex flex-none gap-6 sm:gap-10">
              {RAIL_PANELS.map((panel) => (
                <li
                  key={panel}
                  data-rail-panel=""
                  className="flex h-[50svh] w-[min(80vw,32rem)] items-end bg-paper-raised p-6 font-sans text-sm"
                >
                  Panel {panel.toLowerCase()}
                </li>
              ))}
            </ul>
          </Rail>
        </Fixture>

        <Fixture
          id="fixture-header-theme"
          name="header-theme"
          note="The header is transparent and fixed on every page. While this band, marked data-header-theme=&quot;dark&quot;, is under the header's bottom edge, the header's ink is dark-paper; it flips back as the band leaves. No scroll listener: an IntersectionObserver band at that edge."
        >
          <div
            data-header-theme="dark"
            className="flex h-[70svh] items-end bg-dark-bg px-6 py-10 font-sans text-sm text-dark-paper sm:px-10"
          >
            data-header-theme=&quot;dark&quot;
          </div>
        </Fixture>

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
