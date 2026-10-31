import type { Metadata } from "next";
import Image from "next/image";
import { LabScene } from "@/components/lab-scene";
import { mediaExists, mediaSrc } from "@/lib/media";
import "./lab.css";

export const metadata: Metadata = {
  title: "Lab",
  description: "A closer look at one object in three dimensions.",
};

const CHAPTERS = [
  {
    number: "01",
    title: "The body",
    body: "Stamped brass, folded and soldered by hand.",
  },
  {
    number: "02",
    title: "The bellows",
    body: "Leather and cloth, pleated to fold flat.",
  },
  {
    number: "03",
    title: "The lens",
    body: "Ground glass, four elements, one aperture ring.",
  },
  {
    number: "04",
    title: "The tripod",
    body: "Ash legs, brass fittings, a friction head.",
  },
  {
    number: "05",
    title: "The whole object",
    body: "Assembled by hand. Still focuses true.",
  },
];

const POSTER = "lab/camera-poster.avif";
const POSTER_ALT = "An antique bellows camera on a wooden tripod, rendered in three dimensions.";

/**
 * Immersive: one object, five chapters. The heading, the intro and every
 * chapter are server HTML; LabScene (a client island) pins them over the
 * poster and, once the poster has loaded, the 3d skill's canvas over that.
 */
export default function LabPage() {
  const poster = mediaExists(POSTER) ? (
    <Image
      data-scene-poster=""
      src={mediaSrc(POSTER)}
      alt={POSTER_ALT}
      width={1920}
      height={1080}
      sizes="100vw"
      preload
    />
  ) : (
    <div data-scene-poster="" aria-hidden="true" className="media-placeholder" />
  );

  return (
    <>
      <div className="px-6 pt-20 pb-12 sm:px-10 lg:pt-28">
        <h1 className="font-display text-5xl tracking-tight lg:text-6xl">Lab</h1>
        <p className="mt-4 max-w-md font-sans text-lg text-ink-soft">
          A closer look at one object in three dimensions.
          <span className="motion-reduce:hidden"> Scroll to move around it.</span>
        </p>
      </div>

      {/*
        scroll-animation: render-bridge (GSAP, on pinned-scene). The chapters
        are the scene's acts, stacked in the pin; the 3d skill's conductor and
        SceneCanvas (src/three/) frame the camera for each one.
      */}
      <LabScene poster={poster}>
        {CHAPTERS.map((chapter) => (
          <li key={chapter.number} data-scene-act="" className="lab-act">
            <span className="font-sans text-sm text-muted">{chapter.number}</span>
            <h2 className="mt-2 font-display text-3xl leading-tight lg:text-4xl">{chapter.title}</h2>
            <p className="mt-3 font-sans text-ink-soft">{chapter.body}</p>
          </li>
        ))}
      </LabScene>
    </>
  );
}
