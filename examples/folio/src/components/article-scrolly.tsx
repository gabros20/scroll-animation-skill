import {
  ScrollyGraphic,
  ScrollyInline,
  ScrollyState,
  ScrollyStep,
  ScrollyStepList,
  ScrollySteps,
} from "@/animation/motion/ScrollySteps";
import { MediaSlot } from "@/components/media-slot";
import { ScrollyPan } from "@/components/scrolly-pan";
import type { JournalArticle, ScrollyPicture } from "@/content/journal";

type Picture = { src: string; alt: string; width: number; height: number; caption?: string; unoptimized?: boolean };

/** The article's own pictures, at the sizes the page already requests them: the section fetches nothing new. */
function pictures(article: JournalArticle): Record<ScrollyPicture, Picture> {
  return {
    detail: article.parallaxFigure,
    // The loop's poster at its own URL, the one the <video> already loaded.
    poster: {
      src: article.loop.poster,
      alt: article.loop.alt,
      width: article.loop.width,
      height: article.loop.height,
      caption: article.loop.caption,
      unoptimized: true,
    },
    cover: article.cover,
  };
}

/**
 * scroll-animation: scrolly-steps (Motion wrapper). A sticky graphic beside
 * the steps from 1024 px up; phones, no JavaScript and print read it stacked,
 * a step's picture in its own flow where the step says so. The graphic's
 * states crossfade (css/scrolly.css, MOTION.disclosure); the two steps on the
 * detail photograph pan across it instead (ScrollyPan), since a picture
 * crossfaded into a crop of itself reads as a glitch, not a move.
 * A Server Component: the steps, the states and every image are in the
 * server's HTML; only the section's root and the pan are client islands.
 */
export function ArticleScrolly({ article }: { article: JournalArticle }) {
  const scrolly = article.scrolly;
  if (!scrolly) return null;
  const media = pictures(article);
  const shown = [...new Set(scrolly.steps.map((step) => step.show))];
  const frames = scrolly.steps.map((step) => (step.show === "detail" && step.frame) || null);

  return (
    <div className="mx-auto mt-20 max-w-6xl lg:mt-28">
      <h2
        id="scrolly-title"
        className="max-w-2xl font-display text-3xl leading-tight tracking-tight lg:text-4xl"
      >
        {scrolly.title}
      </h2>
      <ScrollySteps aria-labelledby="scrolly-title" className="mt-10 gap-x-10 [--scrolly-gap:60svh]">
        <ScrollyGraphic className="py-6">
          {shown.map((key) => {
            const picture = media[key];
            return (
              <ScrollyState
                key={key}
                value={key}
                className="relative overflow-clip rounded-sm bg-paper-raised"
              >
                {key === "detail" ? (
                  <ScrollyPan frames={frames}>
                    <Still picture={picture} />
                  </ScrollyPan>
                ) : (
                  <Still picture={picture} />
                )}
                {picture.caption ? (
                  <figcaption className="absolute bottom-3 left-3 mr-3 rounded-sm bg-paper/90 px-2 py-1 font-sans text-xs text-ink-soft">
                    {picture.caption}
                  </figcaption>
                ) : null}
              </ScrollyState>
            );
          })}
        </ScrollyGraphic>

        <ScrollyStepList>
          {scrolly.steps.map((step, index) => {
            const picture = media[step.show];
            return (
              <ScrollyStep
                key={index}
                show={step.show}
                className="mt-12 max-w-2xl border-transparent first:mt-0 data-[step-state=active]:border-accent motion-safe:transition-colors lg:border-l-2 lg:pl-5"
              >
                <p className="font-sans text-sm tracking-[0.2em] text-muted uppercase">{step.label}</p>
                <p className="mt-2 font-sans text-lg leading-relaxed text-ink-soft">{step.text}</p>
                {step.inline ? (
                  <ScrollyInline className="mt-6">
                    <Still picture={picture} />
                    {picture.caption ? (
                      <figcaption className="mt-3 font-sans text-sm text-muted">{picture.caption}</figcaption>
                    ) : null}
                  </ScrollyInline>
                ) : null}
              </ScrollyStep>
            );
          })}
        </ScrollyStepList>
      </ScrollySteps>
    </div>
  );
}

function Still({ picture }: { picture: Picture }) {
  return (
    <MediaSlot
      kind="image"
      src={picture.src}
      alt={picture.alt}
      width={picture.width}
      height={picture.height}
      unoptimized={picture.unoptimized}
      className="h-full w-full rounded-sm object-cover"
    />
  );
}
