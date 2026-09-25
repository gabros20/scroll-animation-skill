"use client";

import { useGSAP } from "@gsap/react";
import type { ReactNode } from "react";
import { gsap, ScrollTrigger, setupGsap } from "@/animation/gsap/setup";
import { gsapDriver } from "@/animation/smooth/lenis";
import { SmoothScroll } from "@/animation/smooth/SmoothScroll";

// Once per page load, in the browser, before any GSAP block runs (setupGsap
// is idempotent, so both route groups sharing this module is fine).
if (typeof window !== "undefined") setupGsap({ plugins: [useGSAP] });

// Module scope: SmoothScroll reads its driver once, when Lenis starts.
const driver = gsapDriver(gsap, ScrollTrigger);

/**
 * Lenis as the scroll authority for the routes it wraps, on GSAP's ticker:
 * the ticker drives Lenis, then ScrollTrigger reads the new position in the
 * same frame. Leaving the route destroys Lenis and its stamp.
 */
export function LenisScroll({ children }: { children: ReactNode }) {
  return (
    <SmoothScroll authority="lenis" driver={driver}>
      {children}
    </SmoothScroll>
  );
}
