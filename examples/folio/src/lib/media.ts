import { existsSync } from "node:fs";
import { join } from "node:path";

const MEDIA_ROOT = join(process.cwd(), "public", "media");

/**
 * True once `pnpm media` has downloaded and unpacked the `media-v1` release
 * asset into public/media/. Until then this is false for every path, and
 * callers should fall back to a placeholder instead of a broken src.
 *
 * Reads the filesystem directly because this only ever runs on the server
 * (build time or a Server Component render), never in the browser.
 */
export function mediaExists(relativePath: string): boolean {
  return existsSync(join(MEDIA_ROOT, relativePath));
}

/** Public URL for a path inside public/media/. Does not check it exists. */
export function mediaSrc(relativePath: string): string {
  return `/media/${relativePath}`;
}
