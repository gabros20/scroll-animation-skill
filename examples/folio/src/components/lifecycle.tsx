"use client";

import { usePathname } from "next/navigation";
import { PageLifecycle } from "@/animation/react/PageLifecycle";

/**
 * The page lifecycle's route adapter (page.ts), once per client navigation:
 * each pathname is a visit. The new page's entrances wait until the router
 * has placed the scroll and the view transition has ended, the refreshes the
 * shown routes registered run once, and again as late content lands; the
 * route's scroll authority follows the router by its own rule. It renders
 * nothing, so it sits anywhere in the root layout. No GSAP here: the GSAP
 * routes register ScrollTrigger.refresh themselves (LenisScroll, Rail), so
 * the journal never loads it.
 */
export function Lifecycle() {
  return <PageLifecycle route={usePathname()} />;
}
