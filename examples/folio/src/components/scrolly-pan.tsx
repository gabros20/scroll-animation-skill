"use client";

import { animate } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { CURVES, MOTION, prefersReducedMotion } from "@/animation/config";
import { useScrollyActive } from "@/animation/motion/ScrollySteps";
import type { ScrollyFrame } from "@/content/journal";

/**
 * A still the scrolly graphic pans across: two steps that show the same
 * photograph move the camera from one frame to the next instead of
 * crossfading the picture into itself. One Motion `animate` per step change,
 * on transform only, MOTION.entrance on its curve (a long landing, like the
 * page's entrances); never per frame.
 *
 * It jumps instead of panning when there is nothing to watch: the step the
 * page landed on (a reload, a #fragment: direction is null on the core's first
 * report), reduced motion (read live: Motion's MotionConfig doesn't reach an
 * imperative animate), and the stacked layout, where the graphic isn't shown.
 * A step without a frame of its own leaves the camera where it is, so it is
 * already in place when the reader scrolls back up to it.
 */
export function ScrollyPan({
  frames,
  children,
}: {
  /** The frame for each step index; steps that show another picture have none. */
  frames: (ScrollyFrame | null)[];
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { active, direction } = useScrollyActive();
  const frame = frames[active];

  useEffect(() => {
    const el = ref.current;
    if (!el || !frame) return;
    const shown = el.closest('[data-scrolly-mode="sticky"]') !== null;
    const jump = direction === null || !shown || prefersReducedMotion();
    const controls = animate(
      el,
      { x: frame.x, y: frame.y, scale: frame.scale },
      jump
        ? { duration: 0 }
        : { duration: MOTION.entrance.duration, ease: CURVES[MOTION.entrance.curve] },
    );
    return () => controls.stop();
  }, [frame, direction]);

  const first = frames.find((f) => f !== null);
  return (
    <div
      ref={ref}
      className="h-full w-full"
      // The server's frame: the first step's, so the graphic is framed before
      // the core mounts and the first report has nothing to move.
      style={first ? { transform: `translateX(${first.x}) translateY(${first.y}) scale(${first.scale})` } : undefined}
    >
      {children}
    </div>
  );
}
