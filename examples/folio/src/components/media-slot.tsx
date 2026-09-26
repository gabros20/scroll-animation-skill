import Image from "next/image";
import { LoopVideo } from "@/animation/motion/LoopVideo";
import { mediaExists, mediaSrc } from "@/lib/media";

type MediaSlotProps = {
  kind: "image" | "loop";
  /** Path relative to public/media/, e.g. "journal/kiln-cover.avif". */
  src: string;
  alt: string;
  /** Loop only: poster path relative to public/media/. */
  poster?: string;
  width: number;
  height: number;
  className?: string;
  /** Passed to next/image for the LCP hero image only. */
  priority?: boolean;
};

/**
 * The one place every page reaches for image or video src. Renders the real
 * element when `pnpm media` has unpacked the file, otherwise a CSS-gradient
 * placeholder sized to the same aspect ratio — no broken <img>, no layout
 * shift once the real asset lands. See docs/designs/folio-art-direction.md
 * for the media list and scripts/fetch-media.mjs for how files arrive.
 */
export function MediaSlot({
  kind,
  src,
  alt,
  poster,
  width,
  height,
  className = "",
  priority = false,
}: MediaSlotProps) {
  if (!mediaExists(src)) {
    return (
      <div
        aria-hidden="true"
        className={`media-placeholder flex items-end justify-start ${className}`}
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <span className="m-3 text-[11px] tracking-wide text-muted uppercase">
          Media pending
        </span>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <Image
        src={mediaSrc(src)}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className={className}
      />
    );
  }

  // LoopVideo (a client island) plays it in view and pauses it out of view,
  // under reduced motion and on Save-Data, and always shows its pause control
  // (a loop runs past WCAG 2.2.2's five seconds). Its <video> is aria-hidden;
  // `alt` gives the footage its text alternative.
  return (
    <div className="relative" style={{ aspectRatio: `${width} / ${height}` }}>
      <LoopVideo
        poster={poster ? mediaSrc(poster) : undefined}
        className={`h-full w-full object-cover ${className}`}
        alt={alt}
        playLabel="Play loop"
        pauseLabel="Pause loop"
        toggleClassName="absolute right-3 bottom-3 rounded-full bg-ink/70 px-3 py-1.5 font-sans text-xs text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <source src={mediaSrc(src)} type="video/mp4" />
      </LoopVideo>
    </div>
  );
}
