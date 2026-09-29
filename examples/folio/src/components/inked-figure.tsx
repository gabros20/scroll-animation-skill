"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { inkImage } from "@/animation/image-ink";

/**
 * A figure whose image sets the header's ink from its own pixels (image-ink.ts): dark-paper ink over the dark parts of
 * the photograph, the default ink over the light parts. One tiny canvas read once the image has decoded; nothing runs
 * while the page scrolls. An image narrower than three quarters of the viewport sets nothing, so on a wide screen the
 * header stays over the paper around a column-width cover.
 */
export function InkedFigure({ children, className }: { children: ReactNode; className?: string }) {
  const figure = useRef<HTMLElement>(null);
  useEffect(() => (figure.current ? inkImage(figure.current) : undefined), []);
  return (
    <figure ref={figure} data-image-ink="" className={className}>
      {children}
    </figure>
  );
}
