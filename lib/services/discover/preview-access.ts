import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a link's key opens the trips page while it is locked to the public.
 *
 * Both sides are hashed first so the comparison is between two equal-length digests and takes the
 * same time wherever the strings differ. With no key configured nothing opens: the safe default for
 * a door that is only meant to exist when someone has deliberately cut a key for it.
 */
export function isPreviewKey(candidate: string, env: Record<string, string | undefined> = process.env): boolean {
  const key = env.DISCOVER_PREVIEW_KEY?.trim();
  if (!key || key.length < 16) return false;

  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(candidate), digest(key));
}
