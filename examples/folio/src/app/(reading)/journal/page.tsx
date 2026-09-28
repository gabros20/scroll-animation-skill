import type { Metadata } from "next";
import Link from "next/link";
import { Reveal, RevealItem } from "@/animation/motion/Reveal";
import { MediaSlot } from "@/components/media-slot";
import { journalArticles } from "@/content/journal";

export const metadata: Metadata = {
  title: "Journal",
  description: "Long stories about objects and the places that made them.",
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

export default function JournalIndexPage() {
  return (
    <div className="px-6 py-20 sm:px-10 lg:py-28">
      <h1 className="font-display text-5xl tracking-tight lg:text-6xl">Journal</h1>
      <p className="mt-4 max-w-md font-sans text-lg text-ink-soft">
        Long stories about objects and the places that made them.
      </p>

      {/*
        Reveal staggers the cards in as the list arrives: each card's text,
        not its cover. The covers are in view at load, and the first one is
        the page's LCP element, which never waits for hydration. The cover
        is also the shared-element source for the article hero
        (view-transitions, Phase 4).
      */}
      <Reveal as="ol" stagger={0.12} className="mt-16 grid gap-12 sm:grid-cols-2 lg:gap-16">
        {journalArticles.map((article) => (
          <li key={article.slug}>
            <Link href={`/journal/${article.slug}`} className="group block">
              <MediaSlot
                kind="image"
                src={article.cover.src}
                alt={article.cover.alt}
                width={article.cover.width}
                height={article.cover.height}
                className="w-full rounded-sm"
              />
              <RevealItem>
                <p className="mt-5 font-sans text-sm tracking-[0.2em] text-muted uppercase">
                  {article.category}
                </p>
                <h2 className="mt-2 font-display text-2xl leading-snug group-hover:text-accent lg:text-3xl">
                  {article.title}
                </h2>
                <p className="mt-2 font-sans text-ink-soft">{article.dek}</p>
                <p className="mt-3 font-sans text-sm text-muted">
                  {dateFormatter.format(new Date(article.publishedOn))} ·{" "}
                  {article.readMinutes} min read
                </p>
              </RevealItem>
            </Link>
          </li>
        ))}
      </Reveal>
    </div>
  );
}
