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
 * How good a photo is to lead with: big, landscape and full of detail. Portraits crop
 * badly into a card and a near-plain photo reads as a background. A photo the site would
 * not let us measure scores nothing, so it follows every measured one.
 */
export function photoScore(measure: PhotoFinding | undefined): number {
  if (!measure || typeof measure !== "object") return 0;
  const { width, height, spread } = measure;
  const size = Math.min(width, 2400) * Math.min(height, 1600) / 1_000_000;
  const shape = width >= height ? 1 : 0.6;
  const detail = Math.min(Math.max(spread / 40, 0.5), 1.2);
  return size * shape * detail;
}

/**
 * The page as it will be imported: every trip keeps only its photos that passed, best
 * first and without repeats, and a hero that failed is swapped for the best trip photo.
 * What was left out is recorded, so the check screen can show it.
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
    // Best first; equal scores keep the operator's own order (sort is stable).
    kept.sort((a, b) => photoScore(measured.get(b)) - photoScore(measured.get(a)));
    const { photosLeftOut: _left, photosUnmeasured: _unmeasured, ...rest } = trip;
    const blocked = unmeasured(kept);
    return { ...rest, images: kept, ...(leftOut.length ? { photosLeftOut: leftOut } : {}), ...(blocked.length ? { photosUnmeasured: blocked } : {}) };
  });

  const { photosLeftOut: _previous, ...rest } = op;
  // The operator's own hero stays unless it fails; with none, or a failed one, their best trip photo leads.
  const heroReason = op.heroImage ? verdict(op.heroImage, "hero") : null;
  if (op.heroImage && !heroReason) return { ...rest, trips };
  const best = trips.flatMap((t) => t.images).sort((a, b) => photoScore(measured.get(b)) - photoScore(measured.get(a)))[0] ?? null;
  return {
    ...rest,
    heroImage: best,
    ...(op.heroImage && heroReason ? { photosLeftOut: [{ url: op.heroImage, reason: heroReason }] } : {}),
    trips,
  };
}

/** Every photo a page uses, once. */
export function photosOf(op: PreparedOperator): string[] {
  return [...new Set([op.heroImage, ...op.trips.flatMap((t) => t.images ?? [])].filter((u): u is string => Boolean(u)))];
}
