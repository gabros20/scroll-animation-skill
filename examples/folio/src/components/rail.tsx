"use client";

import { useGSAP } from "@gsap/react";
import { useRef, type ReactNode } from "react";
import { horizontalRail, type HorizontalRailOptions } from "@/animation/gsap/horizontal-rail";
import { setupGsap } from "@/animation/gsap/setup";

// Once per page load, before any GSAP block runs (idempotent; /blocks has no
// LenisScroll to do it).
if (typeof window !== "undefined") setupGsap({ plugins: [useGSAP] });

/** Serializable: the pages that render a rail are Server Components. */
export type RailOptions = Pick<HorizontalRailOptions, "headHoldPx" | "tailLeadPx">;

type RailProps = {
  /** The id of the heading that names the track, a region. */
  labelledBy: string;
  /** Pinned with the track, above it: a heading, say. */
  pinned?: ReactNode;
  options?: RailOptions;
  className?: string;
  /** Layout inside the track (padding, alignment): css/rail.css owns its display and height. */
  trackClassName?: string;
  /** The panels, server-rendered: every one carries data-rail-panel. */
  children: ReactNode;
};

/**
 * GSAP's horizontalRail (a pinnedScene whose band slides the track) in the
 * markup its header documents. Under reduced motion the pin and the runway
 * go and the track is a native horizontal snap scroller, focusable, so this
 * one markup is the fallback too. On `/` it runs under Lenis on GSAP's
 * ticker, like the orbit above it; its useGSAP runs after the orbit's, so the
 * triggers are created in page order.
 */
export function Rail({ labelledBy, pinned, options, className, trackClassName, children }: RailProps) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const rail = horizontalRail(el, options);
      return () => rail?.destroy();
    },
    { scope: root },
  );

  return (
    <section ref={root} data-scene-root="" data-rail="" className={className}>
      <div data-scene-pin="">
        {pinned}
        <div data-rail-track="" role="region" aria-labelledby={labelledBy} className={trackClassName}>
          {children}
        </div>
      </div>
      <div data-scene-spacer="" aria-hidden="true" />
    </section>
  );
}
