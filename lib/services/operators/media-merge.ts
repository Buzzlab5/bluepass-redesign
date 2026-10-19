import type { PreparedOperator } from "@/lib/services/operators/prepared-pages";
import type { PreparedVideo } from "@/lib/services/operators/videos";

/** What a researcher gathered from the operator's own site: see operator-pages-pilot/media/MEDIA_SCHEMA.md. */
export type OperatorMedia = {
  slug: string;
  logo?: string | null;
  heroImage?: string | null;
  gallery?: string[];
  videos?: PreparedVideo[];
  trips?: { title: string; images?: string[] }[];
  notes?: string | null;
};

const unique = (urls: (string | null | undefined)[]) => [...new Set(urls.filter((u): u is string => Boolean(u?.trim())).map((u) => u.trim()))];

/**
 * The page with the operator's media laid in: their logo, gallery and videos, a better
 * hero when one was found, and each trip's photos added to the ones it had. The photo
 * check that runs next orders them best first and leaves out what would look broken.
 */
export function mergeMedia(op: PreparedOperator, media: OperatorMedia | null): PreparedOperator {
  if (!media || media.slug !== op.slug) return op;
  const byTitle = new Map((media.trips ?? []).map((t) => [t.title.trim(), t.images ?? []]));
  return {
    ...op,
    mediaChecked: true,
    mediaNotes: media.notes?.trim() || null,
    logo: media.logo?.trim() || op.logo || null,
    heroImage: media.heroImage?.trim() || op.heroImage || null,
    gallery: unique([...(op.gallery ?? []), ...(media.gallery ?? [])]),
    videos: media.videos?.length ? media.videos : op.videos,
    trips: op.trips.map((t) => {
      const more = byTitle.get(t.title.trim());
      return more?.length ? { ...t, images: unique([...(t.images ?? []), ...more]) } : t;
    }),
  };
}
