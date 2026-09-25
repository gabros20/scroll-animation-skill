"use client";

import { useGSAP } from "@gsap/react";
import { useRef } from "react";
import { pinnedScene } from "@/animation/gsap/pinned-scene";
import { scrubVideo } from "@/animation/gsap/scrub-video";

/** Public URLs of the orbit clip, or null until `pnpm media` has run. */
export type OrbitMedia = { src: string; mobileSrc: string; poster: string };

// hero/scrub-camera-*: one full turn in 240 all-intra frames at 30 fps, from
// the three-quarter front view. The turn wraps (its last frame runs straight
// back into its first), so no shorter span of it loops seamlessly: the scene
// HOLDS both ends, on the same pose. Each hold is about half an act, so the
// turn starts as the first act leaves and lands as the last one arrives.
const FPS = 30;
const HOLD_PX = 400;

// What the frame shows at rest (and all reduced motion shows): the turn is the
// copy's to describe.
const ALT =
  "An antique folding camera on a wooden tripod, seen from a three-quarter front view against plain paper.";

const CAPTION =
  "An antique folding camera on its wooden tripod, rendered from a 3D model and turned through one full circle.";

// One idea per viewport, each over the part of the turn it describes. `cue`
// promises motion, so reduced motion (a still) drops it, like the angles.
type Act = { angle: string; title: string; body: string; cue?: string };

const ACTS: Act[] = [
  {
    angle: "0°",
    title: "A folding camera, turned once.",
    body: "Brass, leather and ground glass on three ash legs.",
    cue: "Keep scrolling and it comes all the way round.",
  },
  {
    angle: "90°",
    title: "The bellows fold flat.",
    body: "Pleated leather and cloth join the lens to the body, so the whole camera closes to the depth of a book.",
  },
  {
    angle: "270°",
    title: "The lens racks out to focus.",
    body: "Four elements of ground glass behind one aperture ring, run forward on a rail until the picture sharpens.",
  },
  {
    angle: "360°",
    title: "Round again, and it still focuses true.",
    body: "Assembled by hand, one part at a time, the way every object in this issue was made.",
  },
];

/**
 * The pinned scrub scene on `/`: GSAP's scrubVideo (pinnedScene + the video
 * controller), because this route runs Lenis on GSAP's ticker and a scene's
 * scroll-coupled values come from one engine. The copy rides over the pin in
 * normal flow. Under reduced motion scene.css releases the pin, the acts
 * collapse to plain paragraphs and the poster holds the first frame.
 */
export function CameraOrbit({ media }: { media: OrbitMedia | null }) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const holds = { headHoldPx: HOLD_PX, tailLeadPx: HOLD_PX };
      // Without the clip the same scene still runs around the placeholder.
      const scene = scrubVideo(el, { ...holds, fps: FPS }) ?? pinnedScene(el, holds);
      return () => scene.destroy();
    },
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="orbit-heading" data-scene-root="">
      <div data-scene-pin="">
        <h2
          id="orbit-heading"
          className="absolute top-[calc(var(--header-h)+1rem)] left-6 z-10 font-sans text-sm tracking-[0.2em] text-muted uppercase sm:left-10 print:static"
        >
          01 · Object
        </h2>
        {/* The render's frame, under the header. Narrow screens get a 56svh
            frame below the label: a portrait crop of the whole height would
            cut the tripod's legs, and the band left under it takes the copy. */}
        <div
          {...(media ? { role: "img", "aria-label": ALT } : { "aria-hidden": true })}
          className="absolute inset-x-0 top-[calc(var(--header-h)+2.5rem)] h-[56svh] motion-reduce:h-[calc(100svh-var(--header-h)-2.5rem)] lg:top-(--header-h) lg:bottom-0 lg:h-auto print:static print:h-auto"
        >
          {media ? (
            <video
              data-scene-media=""
              data-src={media.src}
              data-mobile-src={media.mobileSrc}
              poster={media.poster}
              muted
              playsInline
              preload="none"
              disablePictureInPicture
              disableRemotePlayback
              aria-hidden="true"
            />
          ) : (
            <div className="media-placeholder h-full w-full" />
          )}
        </div>
      </div>

      <div data-scene-content="">
        {ACTS.map((act, index) => (
          <div
            key={act.angle}
            className="flex flex-col justify-end px-6 py-10 sm:px-10 motion-safe:h-svh lg:motion-safe:justify-center print:h-auto"
          >
            <div
              className={`max-w-sm lg:max-w-xs ${index % 2 === 1 ? "lg:motion-safe:ml-auto" : ""}`}
            >
              <p className="mb-2 font-sans text-sm text-muted motion-reduce:hidden">
                {act.angle}
              </p>
              <p className="font-display text-3xl leading-tight text-balance lg:text-4xl">
                {act.title}
              </p>
              <p className="mt-3 font-sans text-ink-soft">
                {act.body}
                {act.cue ? <span className="motion-reduce:hidden"> {act.cue}</span> : null}
              </p>
              {index === ACTS.length - 1 ? (
                <p className="mt-6 font-sans text-sm text-muted">{CAPTION}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
