import type { Metadata } from "next";
import { MediaSlot } from "@/components/media-slot";

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

export default function LabPage() {
  return (
    <div className="px-6 py-20 sm:px-10 lg:py-28">
      <h1 className="font-display text-5xl tracking-tight lg:text-6xl">Lab</h1>
      <p className="mt-4 max-w-md font-sans text-lg text-ink-soft">
        A closer look at one object in three dimensions. Scroll to move
        around it.
      </p>

      {/*
        scroll-animation: ScrollCanvas + camera-path (Phase 5). Persistent
        R3F canvas, dynamically imported; this poster is what renders before
        it mounts and what reduced motion / no-WebGL show instead.
      */}
      <div className="relative mt-12">
        <MediaSlot
          kind="image"
          src="lab/camera-poster.avif"
          alt="An antique bellows camera on a wooden tripod, rendered in three dimensions."
          width={1920}
          height={1080}
          priority
          className="w-full rounded-sm"
        />
      </div>

      {/*
        Chapter track. camera-path (Phase 5) reads these as its Catmull-Rom
        stops; for now they are plain scroll content, in reading order.
      */}
      <ol className="mx-auto mt-16 max-w-xl">
        {CHAPTERS.map((chapter) => (
          <li key={chapter.number} className="border-t border-line py-8 first:border-t-0">
            <span className="font-sans text-sm text-muted">{chapter.number}</span>
            <h2 className="mt-2 font-display text-2xl">{chapter.title}</h2>
            <p className="mt-2 font-sans text-ink-soft">{chapter.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
