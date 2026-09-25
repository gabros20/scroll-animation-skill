import type { Metadata } from "next";
import { MediaSlot } from "@/components/media-slot";
import { folioObjects } from "@/content/objects";

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

export default function HomePage() {
  return (
    <>
      {/*
        Hero. LCP-safe: the headline is plain server-rendered text, not
        hidden behind hydration. SplitWords (Phase 3) wraps each word in a
        span here without changing what a no-JS reader sees.
      */}
      <section className="px-6 pt-28 pb-24 sm:px-10 lg:pt-40 lg:pb-32">
        <p className="font-sans text-sm tracking-[0.2em] text-muted uppercase">
          Folio · Issue 04
        </p>
        <h1 className="mt-4 max-w-4xl font-display text-5xl leading-[1.05] tracking-tight text-balance sm:text-6xl lg:text-8xl">
          Things, made well.
        </h1>
        <p className="mt-6 max-w-md font-sans text-lg text-ink-soft">
          A journal about designed objects, the buildings that hold them, and
          the materials underneath both.
        </p>
      </section>

      {/*
        scroll-animation: PinnedScene + ScrubVideo (Phase 2).
        One pinned scrub-video scene: a slow orbit around one object.
      */}
      <section aria-labelledby="scrub-heading" className="px-6 sm:px-10">
        <h2
          id="scrub-heading"
          className="font-sans text-sm tracking-[0.2em] text-muted uppercase"
        >
          01 · Object
        </h2>
        <MediaSlot
          kind="video"
          src="hero/scrub-vessel-1920.mp4"
          poster="hero/scrub-vessel-poster.avif"
          alt="A glazed stoneware vessel, rotating slowly against a plain backdrop."
          width={1920}
          height={1080}
          className="mt-4 w-full"
        />
        <p className="mt-3 max-w-md font-sans text-sm text-muted">
          A glazed stoneware vessel, thrown on a wheel and fired in a wood
          kiln.
        </p>
      </section>

      {/*
        scroll-animation: horizontal-rail (Phase 3). Falls back to native
        horizontal scroll here, which is also the reduced-motion behaviour.
      */}
      <section aria-labelledby="objects-heading" className="mt-24 sm:mt-32">
        <h2
          id="objects-heading"
          className="px-6 font-display text-2xl sm:px-10 lg:text-3xl"
        >
          Objects
        </h2>
        <ul className="mt-8 flex snap-x snap-mandatory gap-6 overflow-x-auto px-6 pb-4 sm:px-10">
          {folioObjects.map((object) => (
            <li
              key={object.name}
              className="w-64 shrink-0 snap-start"
            >
              <MediaSlot
                kind="image"
                src={object.image}
                alt={object.alt}
                width={640}
                height={800}
                className="w-full rounded-sm"
              />
              <p className="mt-3 font-sans text-sm font-medium">{object.name}</p>
              <p className="mt-1 font-sans text-sm text-muted">{object.note}</p>
            </li>
          ))}
        </ul>
      </section>

      {/*
        scroll-animation: PinnedScene (sticky stack, Phase 2/3) +
        header-theme (Phase 3). The one dark section on this page; header
        ink flips to dark-paper for its duration.
      */}
      <section
        aria-labelledby="principles-heading"
        className="mt-24 bg-dark-bg px-6 py-24 text-dark-paper sm:mt-32 sm:px-10 lg:py-32"
      >
        <h2 id="principles-heading" className="font-display text-2xl lg:text-3xl">
          How Folio works
        </h2>
        <ol className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {PRINCIPLES.map((principle) => (
            <li key={principle.number}>
              <span className="font-sans text-sm text-dark-muted">
                {principle.number}
              </span>
              <p className="mt-2 font-display text-xl">{principle.title}</p>
              <p className="mt-2 font-sans text-sm text-dark-muted">
                {principle.body}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
