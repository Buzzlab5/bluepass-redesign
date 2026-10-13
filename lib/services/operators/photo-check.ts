import type { PreparedOperator } from "@/lib/services/operators/prepared-pages";

/**
 * Operator websites mix real trip photos with page furniture: wide banners, plain colour
 * backgrounds, thumbnails and screenshots. A researcher reading the page cannot always
 * tell them apart, so each photo is measured before a prepared page is imported and the
 * ones that would look broken on a trip card are left out, with the reason kept beside
 * the trip for whoever checks it.
 */

/**
 * What the importer found for one photo: its size and `spread`, the average colour
 * deviation from 0 to 255; "missing" when it does not exist; "blocked" when the site turns
 * away automated requests. A blocked photo is kept for a person to judge by eye, since the
 * checker does not pretend to be a browser to get past a site's bot rules.
 */
export type PhotoMeasure = { width: number; height: number; spread: number };
export type PhotoFinding = PhotoMeasure | "missing" | "blocked";
export type LeftOutPhoto = { url: string; reason: string };

const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;
const PLAIN_SPREAD = 12;
const WIDEST = { trip: 2.6, hero: 3.2 };

export function photoProblem(url: string, measure: PhotoFinding | undefined, role: "trip" | "hero"): string | null {
  if (measure === "blocked") return null;
  if (!measure || measure === "missing") return "would not load";
  const { width, height, spread } = measure;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return `too small (${width} by ${height})`;
  if (spread < PLAIN_SPREAD) return "almost one plain colour, a page background rather than a photo";
  if (width / height > WIDEST[role]) return "a wide website banner, which crops badly";
  if (/screen[\s_-]?shot/i.test(decodeURIComponent(url))) return "a screenshot";
  return null;
}

/**
 * The page as it will be imported: every trip keeps only its photos that passed, in the
 * operator's order and without repeats, and a hero that failed is swapped for the first
 * good trip photo. What was left out is recorded, so the check screen can show it.
 */
export function applyPhotoChecks(op: PreparedOperator, measured: Map<string, PhotoFinding>): PreparedOperator {
  const verdict = (url: string, role: "trip" | "hero") => photoProblem(url, measured.get(url), role);
  const unmeasured = (urls: string[]) => urls.filter((u) => measured.get(u) === "blocked");

  const trips = op.trips.map((trip) => {
    const kept: string[] = [];
    const leftOut: LeftOutPhoto[] = [];
    for (const url of trip.images ?? []) {
      if (kept.includes(url) || leftOut.some((l) => l.url === url)) continue;
      const reason = verdict(url, "trip");
      if (reason) leftOut.push({ url, reason }); else kept.push(url);
    }
    const { photosLeftOut: _left, photosUnmeasured: _unmeasured, ...rest } = trip;
    const blocked = unmeasured(kept);
    return { ...rest, images: kept, ...(leftOut.length ? { photosLeftOut: leftOut } : {}), ...(blocked.length ? { photosUnmeasured: blocked } : {}) };
  });

  const { photosLeftOut: _previous, ...rest } = op;
  const heroReason = op.heroImage ? verdict(op.heroImage, "hero") : null;
  if (!op.heroImage || !heroReason) return { ...rest, trips };
  return {
    ...rest,
    heroImage: trips.flatMap((t) => t.images).sort((a, b) => Number(measured.get(a) === "blocked") - Number(measured.get(b) === "blocked"))[0] ?? null,
    photosLeftOut: [{ url: op.heroImage, reason: heroReason }],
    trips,
  };
}

/** Every photo a page uses, once. */
export function photosOf(op: PreparedOperator): string[] {
  return [...new Set([op.heroImage, ...op.trips.flatMap((t) => t.images ?? [])].filter((u): u is string => Boolean(u)))];
}
