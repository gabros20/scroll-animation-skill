"use client";

import { useState } from "react";
import { FrameSequence } from "@/animation/motion/FrameSequence";
import { PinnedScene } from "@/animation/motion/PinnedScene";
import { ScrubVideo } from "@/animation/motion/ScrubVideo";
import type { SceneMode } from "@/animation/scene";

// Fixtures, not design: every block runs on its defaults (no hold, loop or
// camera tuning), so what shows here is what `scroll-animation add` ships.

const ACTS = [
  "Head: the first frame holds.",
  "Band: scroll picks the frame.",
  "Tail: the last frame holds.",
];

function Acts() {
  return ACTS.map((act) => (
    <div
      key={act}
      className="flex flex-col justify-end px-6 py-10 font-sans text-sm text-muted sm:px-10 motion-safe:h-svh"
    >
      <p>{act}</p>
    </div>
  ));
}

/** The scene's mode, as data-scene-state has it. */
function ModeReadout({ mode }: { mode: SceneMode }) {
  return (
    <p className="absolute top-[calc(var(--header-h)+1rem)] right-6 z-10 rounded-full bg-ink px-3 py-1 font-sans text-xs text-paper sm:right-10">
      {mode}
    </p>
  );
}

/** PinnedScene + FrameSequence: the sequence draws the scene's band, handed over by the `pinned` render function. */
export function SequenceScene({ manifest, label }: { manifest: string; label: string }) {
  return (
    <PinnedScene
      pinned={({ band, mode }) => (
        <>
          <div className="absolute inset-x-0 top-(--header-h) bottom-0 flex items-center justify-center px-6 sm:px-10">
            <div className="aspect-video w-full max-w-5xl">
              <FrameSequence manifest={manifest} mobile progress={band} label={label} />
            </div>
          </div>
          <ModeReadout mode={mode} />
        </>
      )}
    >
      <Acts />
    </PinnedScene>
  );
}

/**
 * The marquee's pause control (scroll-effects.css §5): it runs on its own for
 * more than 5 s, so WCAG 2.2.2 wants one. A toggle keeps its label and
 * reports its state through aria-pressed.
 */
export function MarqueeToggle({ controls }: { controls: string }) {
  const [paused, setPaused] = useState(false);

  return (
    <button
      type="button"
      aria-controls={controls}
      aria-pressed={paused}
      onClick={() => {
        document.getElementById(controls)?.toggleAttribute("data-marquee-paused", !paused);
        setPaused(!paused);
      }}
      className="rounded-full border border-line px-3 py-1.5 font-sans text-xs aria-pressed:bg-ink aria-pressed:text-paper"
    >
      Pause the marquee
    </button>
  );
}

/** ScrubVideo (Motion): the same clip `/` scrubs with GSAP. */
export function ScrubScene({
  src,
  mobileSrc,
  poster,
}: {
  src: string;
  mobileSrc: string;
  poster: string;
}) {
  const [mode, setMode] = useState<SceneMode>("head");

  return (
    <ScrubVideo
      src={src}
      mobileSrc={mobileSrc}
      poster={poster}
      fps={30}
      pinned={<ModeReadout mode={mode} />}
      onMode={(next) => setMode(next)}
    >
      <Acts />
    </ScrubVideo>
  );
}
