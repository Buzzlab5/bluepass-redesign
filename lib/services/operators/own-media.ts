import type { PreparedOperator, PreparedTrip } from "@/lib/services/operators/prepared-pages";
import type { PreparedVideo } from "@/lib/services/operators/videos";

/**
 * What an operator adds to their own page after claiming it: their logo, photos for the
 * page or for a trip, and videos. Some websites will not let their photos be shown
 * anywhere else, and some have no logo file to find; this is how those pages get theirs.
 *
 * The operator's additions are theirs to publish, so they show straight away, ahead of
 * what was found on the website. A re-import from the website never touches them.
 */
export type OwnMedia = {
  logo?: { url: string; light: boolean } | null;
  /** The photo at the top of the page; with none chosen, their first page photo. */
  hero?: string | null;
  gallery?: string[];
  /** Photos for one trip, by the trip's listing id. */
  trips?: Record<string, string[]>;
  videos?: PreparedVideo[];
};

export const OWN_LIMITS = { gallery: 24, trip: 12, videos: 6 } as const;

const unique = (urls: string[]) => [...new Set(urls)];

/** Every photo and logo the operator added, which the website-photo chooser leaves alone. */
export function ownUrls(own: OwnMedia | null | undefined): Set<string> {
  if (!own) return new Set();
  return new Set([
    ...(own.logo ? [own.logo.url] : []),
    ...(own.gallery ?? []),
    ...Object.values(own.trips ?? {}).flat(),
  ]);
}

/** The page with the operator's additions laid over what was found on their website. */
export function withOwnMedia<T extends { id: string; trip: PreparedTrip }>(
  page: PreparedOperator,
  trips: T[],
  own: OwnMedia | null | undefined,
): { page: PreparedOperator; trips: T[] } {
  if (!own) return { page, trips };
  const gallery = own.gallery ?? [];
  const photos = ownUrls({ ...own, logo: null });
  const hero = own.hero && photos.has(own.hero) ? own.hero : gallery[0] ?? null;
  return {
    page: {
      ...page,
      logo: own.logo?.url ?? page.logo ?? null,
      logoLight: own.logo ? own.logo.light : page.logoLight,
      heroImage: hero ?? page.heroImage ?? null,
      gallery: unique([...gallery, ...(page.gallery ?? [])]),
      videos: [...(own.videos ?? []), ...(page.videos ?? [])],
    },
    trips: trips.map((t) => {
      const mine = own.trips?.[t.id] ?? [];
      return mine.length ? { ...t, trip: { ...t.trip, images: unique([...mine, ...(t.trip.images ?? [])]) } } : t;
    }),
  };
}

/** The operator's media with one photo, logo or video taken away, wherever it was. */
export function withoutOwn(own: OwnMedia, url: string): OwnMedia {
  return {
    ...own,
    logo: own.logo?.url === url ? null : own.logo ?? null,
    hero: own.hero === url ? null : own.hero ?? null,
    gallery: (own.gallery ?? []).filter((u) => u !== url),
    trips: Object.fromEntries(Object.entries(own.trips ?? {}).map(([id, list]) => [id, list.filter((u) => u !== url)]).filter(([, list]) => list.length)),
    videos: (own.videos ?? []).filter((v) => v.url !== url),
  };
}
