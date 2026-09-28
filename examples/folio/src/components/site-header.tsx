"use client";

import Link from "next/link";
import { useRef } from "react";
import { useHeaderTheme } from "@/animation/motion/useHeaderTheme";

const NAV_LINKS = [
  { href: "/journal", label: "Journal" },
  { href: "/lab", label: "Lab" },
  { href: "/blocks", label: "Blocks" },
];

/**
 * Transparent and fixed, so its ink has to follow the page: header-theme
 * writes data-header-ink from the section under the header's bottom edge
 * (the one dark section on `/` flips it to dark-paper, globals.css), with
 * an IntersectionObserver band, so it is exact under Lenis too. Fixed, not
 * sticky: a stuck sticky header's offsetTop is the scroll offset, which
 * would put the probe line off screen whenever it is measured mid-page.
 * The server renders the top of every page's ink, so the first paint needs
 * no write. In print it is absolute: once, on the first page, in the room
 * the body pads for it.
 */
export function SiteHeader() {
  const header = useRef<HTMLElement>(null);
  useHeaderTheme(header);

  return (
    <header
      ref={header}
      data-header=""
      data-header-ink-default="light"
      data-header-ink="light"
      className="fixed inset-x-0 top-0 z-40 flex h-(--header-h) items-center justify-between px-6 text-ink sm:px-10 print:absolute"
    >
      <Link href="/" className="font-display text-xl tracking-tight">
        Folio
      </Link>
      <nav aria-label="Primary" className="flex items-center gap-6 font-sans text-sm">
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="hover:text-accent">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
