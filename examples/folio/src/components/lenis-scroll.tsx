"use client";

import { useGSAP } from "@gsap/react";
import type { ReactNode } from "react";
import { gsap, ScrollTrigger, setupGsap } from "@/animation/gsap/setup";
import { gsapDriver } from "@/animation/smooth/lenis";
import { onRouteRefresh } from "@/animation/smooth/route";
import { SmoothScroll } from "@/animation/smooth/SmoothScroll";

// Once per page load, in the browser, before any GSAP block runs (setupGsap
// is idempotent, so both route groups sharing this module is fine).
if (typeof window !== "undefined") {
  setupGsap({ plugins: [useGSAP] });
  // ?motion-debug (or <html data-motion-debug>): verify-scenes counts the live
  // triggers across client navigations, which must come back to the same number.
  if ("motionDebug" in document.documentElement.dataset || new URLSearchParams(location.search).has("motion-debug")) {
    (window as Window & { __triggers?: () => number }).__triggers = () => ScrollTrigger.getAll().length;
  }
}

// Module scope: SmoothScroll reads its driver once, when Lenis starts.
const driver = gsapDriver(gsap, ScrollTrigger);

/**
 * Lenis as the scroll authority for the routes it wraps, on GSAP's ticker:
 * the ticker drives Lenis, then ScrollTrigger reads the new position in the
 * same frame. Leaving the route destroys Lenis and its stamp. While the
 * route is shown, RouteScroll's contract refreshes ScrollTrigger on each
 * navigation (registered here, so the root layout needs no GSAP).
 */
export function LenisScroll({ children }: { children: ReactNode }) {
  useGSAP(() => onRouteRefresh(ScrollTrigger.refresh));
  return (
    <SmoothScroll authority="lenis" driver={driver}>
      {children}
    </SmoothScroll>
  );
}
