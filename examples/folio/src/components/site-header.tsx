import Link from "next/link";

const NAV_LINKS = [
  { href: "/journal", label: "Journal" },
  { href: "/lab", label: "Lab" },
  { href: "/blocks", label: "Blocks" },
];

// Static for now. header-theme (Phase 3) flips this from ink to dark-paper
// while the page scrolls through the one dark section on `/` — see the
// "header ink" row in docs/designs/folio-art-direction.md.
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 flex h-(--header-h) items-center justify-between px-6 text-ink sm:px-10">
      <Link href="/" className="font-display text-xl tracking-tight">
        Folio
      </Link>
      <nav aria-label="Primary" className="flex items-center gap-6 font-sans text-sm">
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="transition-colors hover:text-accent">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
