import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Reveal, RevealItem } from "@/animation/motion/Reveal";
import { SplitWords } from "@/animation/motion/SplitWords";
import { InkedFigure } from "@/components/inked-figure";
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
        Reading progress: scroll-effects.css scales the bar with the page's
        scroll(root), in the scroll's own frame. Where scroll timelines don't
        run (Firefox) and under reduced motion it isn't drawn: a bar frozen at
        one length would report the wrong place everywhere else. Decorative,
        so there is no aria-valuenow to keep honest.
      */}
      <div
        data-scroll-fx="progress"
        aria-hidden="true"
        className="fixed inset-x-0 top-0 z-50 h-1 bg-accent"
      />

      <header className="mx-auto max-w-2xl">
        <p className="font-sans text-sm tracking-[0.2em] text-muted uppercase">
          {article.category}
        </p>
        {/*
          SplitWords: split on the server, risen word by word by CSS from the
          first frame, named by the whole title. Never SplitText here: React
          owns this text.
          scroll-animation: view-transitions shared element from the
          /journal index card (Phase 4).
        */}
        <SplitWords
          text={article.title}
          className="mt-3 font-display text-4xl leading-tight tracking-tight lg:text-6xl"
        />
        <p className="mt-4 font-sans text-lg text-ink-soft">{article.dek}</p>
        <p className="mt-3 font-sans text-sm text-muted">
          {dateFormatter.format(new Date(article.publishedOn))} ·{" "}
          {article.readMinutes} min read
        </p>
      </header>

      {/* The header's ink follows the cover's own pixels as it passes under it (image-ink, header-theme block). */}
      <InkedFigure className="mx-auto mt-10 w-full max-w-3xl">
        <MediaSlot
          kind="image"
          src={article.cover.src}
          alt={article.cover.alt}
          width={article.cover.width}
          height={article.cover.height}
          priority
          className="w-full rounded-sm"
        />
      </InkedFigure>

      {/*
        The body arrives by trigger, one Reveal per arrival: each paragraph
        and each figure rises in as its top crosses the reveal line, and a
        figure's caption follows its media. Nothing here is scroll-linked
        but the parallax, which is decoration.
      */}
      <div className="mx-auto mt-12 max-w-2xl font-sans text-lg leading-relaxed text-ink-soft">
        {firstHalf.map((paragraph, index) => (
          <Reveal key={index} className="mt-6 first:mt-0">
            <RevealItem as="p">{paragraph}</RevealItem>
          </Reveal>
        ))}

        {/*
          CSS parallax (scroll-effects.css): the photograph drifts 3rem either
          side of centre inside a frame that clips it, as the frame crosses
          the viewport. The frame clips with overflow: clip, never hidden,
          which would make it the view() timeline's scroller and freeze the
          drift (S7c). Firefox and reduced motion show the static state, the
          photograph centred in its frame.
        */}
        <Reveal as="figure" className="my-12 -mx-6 sm:mx-0">
          <RevealItem className="relative aspect-[4/5] overflow-clip rounded-sm">
            <MediaSlot
              kind="image"
              src={article.parallaxFigure.src}
              alt={article.parallaxFigure.alt}
              width={article.parallaxFigure.width}
              height={article.parallaxFigure.height}
              fx="parallax"
              className="absolute inset-x-0 -top-12 h-[calc(100%+6rem)] w-full object-cover [--fx-parallax:3rem]"
            />
          </RevealItem>
          <RevealItem as="figcaption" className="mt-3 font-sans text-sm text-muted">
            {article.parallaxFigure.caption}
          </RevealItem>
        </Reveal>

        {/*
          scroll-animation: loop-video (Motion). A small client island with
          the pause control WCAG 2.2.2 requires; the article stays a Server
          Component.
        */}
        <Reveal as="figure" className="my-12 -mx-6 sm:mx-0">
          <RevealItem>
            <MediaSlot
              kind="loop"
              src={article.loop.src}
              poster={article.loop.poster}
              alt={article.loop.alt}
              width={article.loop.width}
              height={article.loop.height}
              className="rounded-sm"
            />
          </RevealItem>
          <RevealItem as="figcaption" className="mt-3 font-sans text-sm text-muted">
            {article.loop.caption}
          </RevealItem>
        </Reveal>

        {secondHalf.map((paragraph, index) => (
          <Reveal key={index} className="mt-6">
            <RevealItem as="p">{paragraph}</RevealItem>
          </Reveal>
        ))}
      </div>
    </article>
  );
}
