import Image from "next/image";
import { mediaExists, mediaSrc } from "@/lib/media";

type MediaSlotProps = {
  kind: "image" | "video";
  /** Path relative to public/media/, e.g. "journal/kiln-cover.avif". */
  src: string;
  alt: string;
  /** Video only: poster path relative to public/media/. */
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

  return (
    <video
      className={className}
      width={width}
      height={height}
      style={{ aspectRatio: `${width} / ${height}` }}
      poster={poster ? mediaSrc(poster) : undefined}
      muted
      loop
      playsInline
      preload="none"
      aria-label={alt}
    >
      <source src={mediaSrc(src)} />
    </video>
  );
}
