import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MediaSlot } from "@/components/media-slot";
import { getJournalArticle, journalArticles } from "@/content/journal";

export function generateStaticParams() {
  return journalArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata(
  props: PageProps<"/journal/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const article = getJournalArticle(slug);
  if (!article) return {};
  return { title: article.title, description: article.dek };
}

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

export default async function JournalArticlePage(
  props: PageProps<"/journal/[slug]">,
) {
  const { slug } = await props.params;
  const article = getJournalArticle(slug);
  if (!article) notFound();

  const [firstHalf, secondHalf] = [
    article.body.slice(0, 2),
    article.body.slice(2),
  ];

  return (
    <article className="px-6 py-20 sm:px-10 lg:py-28">
      {/*
        scroll-animation: reading progress (Phase 3). Decorative until then
        — no scroll listener means no JS to keep an aria-valuenow honest.
      */}
      <div aria-hidden="true" className="fixed inset-x-0 top-0 z-50 h-1 bg-line">
        <div className="h-full w-0 bg-accent" />
      </div>

      <header className="mx-auto max-w-2xl">
        <p className="font-sans text-sm tracking-[0.2em] text-muted uppercase">
          {article.category}
        </p>
        {/*
          scroll-animation: view-transitions shared element from the
          /journal index card (Phase 4).
        */}
        <h1 className="mt-3 font-display text-4xl leading-tight tracking-tight lg:text-6xl">
          {article.title}
        </h1>
        <p className="mt-4 font-sans text-lg text-ink-soft">{article.dek}</p>
        <p className="mt-3 font-sans text-sm text-muted">
          {dateFormatter.format(new Date(article.publishedOn))} ·{" "}
          {article.readMinutes} min read
        </p>
      </header>

      <MediaSlot
        kind="image"
        src={article.cover.src}
        alt={article.cover.alt}
        width={article.cover.width}
        height={article.cover.height}
        priority
        className="mx-auto mt-10 w-full max-w-3xl rounded-sm"
      />

      <div className="mx-auto mt-12 max-w-2xl font-sans text-lg leading-relaxed text-ink-soft">
        {firstHalf.map((paragraph, index) => (
          <p key={index} className="mt-6 first:mt-0">
            {paragraph}
          </p>
        ))}

        {/*
          scroll-animation: CSS parallax (scroll-effects.css, Phase 3). The
          figure offsets slightly against the text column on scroll.
        */}
        <figure className="my-12 -mx-6 sm:mx-0">
          <MediaSlot
            kind="image"
            src={article.parallaxFigure.src}
            alt={article.parallaxFigure.alt}
            width={article.parallaxFigure.width}
            height={article.parallaxFigure.height}
            className="w-full rounded-sm"
          />
          <figcaption className="mt-3 font-sans text-sm text-muted">
            {article.parallaxFigure.caption}
          </figcaption>
        </figure>

        {/*
          scroll-animation: LoopVideo (Phase 2). The pause button is real
          structure — WCAG 2.2.2 requires it once the loop autoplays — but
          has no handler yet: LoopVideo hydrates this as a small client
          island rather than making the whole article interactive.
        */}
        <figure className="my-12 -mx-6 sm:mx-0">
          <div className="relative">
            <MediaSlot
              kind="video"
              src={article.loop.src}
              poster={article.loop.poster}
              alt={article.loop.alt}
              width={article.loop.width}
              height={article.loop.height}
              className="w-full rounded-sm"
            />
            <button
              type="button"
              aria-label="Pause loop"
              className="absolute right-3 bottom-3 rounded-full bg-ink/70 px-3 py-1.5 font-sans text-xs text-paper"
            >
              Pause
            </button>
          </div>
          <figcaption className="mt-3 font-sans text-sm text-muted">
            {article.loop.caption}
          </figcaption>
        </figure>

        {secondHalf.map((paragraph, index) => (
          <p key={index} className="mt-6">
            {paragraph}
          </p>
        ))}
      </div>
    </article>
  );
}
