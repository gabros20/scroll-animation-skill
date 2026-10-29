"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { RouteChange } from "@/animation/smooth/SmoothScroll";

/**
 * The route contract (smooth/route.ts), once per client navigation: the
 * route's scroll authority takes up the position Next placed (a Lenis glide
 * in flight would override it), then the refreshes the shown routes
 * registered, once, for anything the navigation didn't re-create, and again
 * as late content lands. Around the root layout's children, so its layout
 * effect runs after every route's own. No GSAP here: the GSAP routes register
 * ScrollTrigger.refresh themselves (LenisScroll, Rail), so the journal never
 * loads it.
 */
export function RouteScroll({ children }: { children: ReactNode }) {
  return <RouteChange route={usePathname()}>{children}</RouteChange>;
}
