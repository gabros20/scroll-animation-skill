import type { Metadata } from "next";
import { Reveal, RevealItem } from "@/animation/motion/Reveal";
import { SplitWords } from "@/animation/motion/SplitWords";
import { CameraOrbit } from "@/components/camera-orbit";
import { MediaSlot } from "@/components/media-slot";
import { Rail, type RailOptions } from "@/components/rail";
import { folioObjects } from "@/content/objects";
import { mediaExists, mediaSrc } from "@/lib/media";

export const metadata: Metadata = {
  title: "Folio",
  description:
    "A journal about designed objects, the buildings that hold them, and the materials underneath both.",
};

const PRINCIPLES = [
  {
    number: "01",
    title: "One subject",
    body: "Every issue covers one object or one place. Never a roundup, never a top ten.",
  },
  {
    number: "02",
    title: "Made, not styled",
    body: "We ask how a thing was built before we ask how it looks finished.",
  },
  {
    number: "03",
    title: "Slow reading",
    body: "Long stories, few interruptions, no infinite scroll.",
  },
];

// The first panel holds still for a moment after the rail pins, and the last
// one sits flush for as long before it lets go.
const RAIL_HOLDS: RailOptions = { headHoldPx: 120, tailLeadPx: 120 };

export default function HomePage() {
  const orbit = mediaExists("hero/scrub-camera-1920.mp4")
    ? {
        src: mediaSrc("hero/scrub-camera-1920.mp4"),
        mobileSrc: mediaSrc("hero/scrub-camera-1080.mp4"),
        poster: mediaSrc("hero/scrub-camera-poster.avif"),
      }
    : null;

  return (
    <>
      {/*
        Hero. The headline is the LCP element: SplitWords splits it on the
        server and css/split.css rises it word by word from the first frame,
        with no JavaScript on its path; its name is still the sentence. The
        eyebrow and the standfirst come in on mount, at hydration. No
        RevealVeil: it would cover the headline that must paint at once.
      */}
      <Reveal as="section" trigger="mount" className="px-6 pt-28 pb-24 sm:px-10 lg:pt-40 lg:pb-32">
        <RevealItem as="p" className="font-sans text-sm tracking-[0.2em] text-muted uppercase">
          Folio · Issue 04
        </RevealItem>
        <SplitWords
          text="Things, made well."
          className="mt-4 max-w-4xl font-display text-5xl leading-[1.05] tracking-tight text-balance sm:text-6xl lg:text-8xl"
        />
        <RevealItem as="p" className="mt-6 max-w-md font-sans text-lg text-ink-soft">
          A journal about designed objects, the buildings that hold them, and
          the materials underneath both.
        </RevealItem>
      </Reveal>

      {/*
        scroll-animation: scrub-video (GSAP, on pinned-scene). One pinned
        scrub scene: a slow orbit around one object, copy riding over it.
      */}
      <CameraOrbit media={orbit} />

      {/*
        scroll-animation: horizontal-rail (GSAP). The rail pins and slides
        the six objects across; under reduced motion the same track is a
        native horizontal snap scroller. Panels are sized from the viewport
        height, so a whole panel and its caption fit under the heading.
      */}
      <Rail
        className="mt-24 sm:mt-32"
        labelledBy="objects-heading"
        options={RAIL_HOLDS}
        pinned={
          <Reveal className="absolute top-[calc(var(--header-h)+1.5rem)] left-6 z-10 sm:left-10">
            <RevealItem as="h2" id="objects-heading" className="font-display text-2xl lg:text-3xl">
              Objects
            </RevealItem>
          </Reveal>
        }
        trackClassName="items-center scroll-px-6 px-6 pt-[calc(var(--header-h)+4.5rem)] pb-10 sm:scroll-px-10 sm:px-10"
      >
        {/* The row is one arrival: its captions rise in, line by line, as
            the rail comes up the page. Never per panel: sideways the panels
            move with the scroll, and a jump can carry one past the viewport
            without it ever crossing a line. */}
        <Reveal as="ul" className="flex flex-none gap-6 sm:gap-10">
          {folioObjects.map((object) => (
            <li
              key={object.name}
              data-rail-panel=""
              className="w-[min(72vw,calc((100svh-var(--header-h))*0.5))]"
            >
              <MediaSlot
                kind="image"
                src={object.image}
                alt={object.alt}
                width={640}
                height={800}
                className="w-full rounded-sm"
              />
              <RevealItem as="p" className="mt-3 font-sans text-sm font-medium">
                {object.name}
              </RevealItem>
              <RevealItem as="p" className="mt-1 font-sans text-sm text-muted">
                {object.note}
              </RevealItem>
            </li>
          ))}
        </Reveal>
      </Rail>

      {/*
        The one dark section: header-theme flips the header's ink to
        dark-paper while it is under the header. The three principles are a
        sticky stack (scroll-effects.css): each card sticks under the header
        and the next slides over it. The stack is layout, so it reads the same
        with no animation at all (Firefox, reduced motion, and Safari under
        Lenis, where a CSS timeline is a frame late and so only decoration);
        where timelines run, a covered card also shrinks. It doesn't dim:
        dimming fades a card's background too, and the card it covers would
        show through it while the next one arrives. At 60svh a card stays
        whole under the header at the very end of the page, and the spacer
        after the stack holds the last one for a moment.
      */}
      <section
        data-header-theme="dark"
        aria-labelledby="principles-heading"
        className="mt-24 bg-dark-bg px-6 py-24 text-dark-paper sm:mt-32 sm:px-10 lg:py-32"
      >
        <Reveal>
          <RevealItem as="h2" id="principles-heading" className="font-display text-2xl lg:text-3xl">
            How Folio works
          </RevealItem>
        </Reveal>
        <ol
          data-scroll-fx="sticky-stack"
          className="mt-10 after:block after:h-[20svh] after:content-['']"
        >
          {PRINCIPLES.map((principle) => (
            <li
              key={principle.number}
              className="flex min-h-[60svh] flex-col justify-between border-t border-dark-muted/30 bg-dark-bg py-10 lg:py-14"
            >
              <span className="font-sans text-sm text-dark-muted">{principle.number}</span>
              <div>
                <h3 className="font-display text-4xl leading-tight text-balance sm:text-5xl lg:text-7xl">
                  {principle.title}
                </h3>
                <p className="mt-4 max-w-md font-sans text-lg text-dark-muted">{principle.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
