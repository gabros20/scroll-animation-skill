"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ScrollTrigger } from "@/animation/gsap/setup";
import { RouteChange } from "@/animation/smooth/SmoothScroll";

// Only a page that made a trigger has anything to re-measure: the Reading
// routes never start ScrollTrigger, and a refresh would start it (its scroll
// and resize listeners) on a page with nothing to measure.
const refresh = () => {
  if (ScrollTrigger.getAll().length) ScrollTrigger.refresh();
};

/**
 * The route contract (smooth/route.ts), once per client navigation: the
 * route's scroll authority takes up the position Next placed (a Lenis glide
 * in flight would override it), then one ScrollTrigger refresh for anything
 * the navigation didn't re-create. Around the root layout's children, so its
 * layout effect runs after every route's own.
 */
export function RouteScroll({ children }: { children: ReactNode }) {
  return (
    <RouteChange route={usePathname()} refresh={refresh}>
      {children}
    </RouteChange>
  );
}
