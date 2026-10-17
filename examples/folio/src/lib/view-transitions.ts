import type { ViewTransitionProps } from "react";

/** The name a journal cover carries on the index card and on its article's hero: one name, one morph. */
export function coverName(slug: string): string {
  return `cover-${slug}`;
}

/**
 * A page that slides with the navigation's direction: Links pass
 * transitionTypes ["forward"] or ["back"], and view-transitions.css slides
 * the vt-forward and vt-back classes on MOTION.route. A navigation with
 * neither type (the header's links, the browser's own back and forward)
 * gives the page no name, so it is part of the root's crossfade. On every
 * page.tsx that takes part, never a layout: a layout persists across the
 * navigation, so it never enters or exits.
 */
export const PAGE_SLIDE = {
  enter: { forward: "vt-forward", back: "vt-back", default: "none" },
  exit: { forward: "vt-forward", back: "vt-back", default: "none" },
  default: "none",
} satisfies ViewTransitionProps;
