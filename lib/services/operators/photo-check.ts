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
export type PhotoMeasure = { width: number; height: number; spread: number; bytes?: number; print?: string };
export type PhotoFinding = PhotoMeasure | "missing" | "blocked";
export type LeftOutPhoto = { url: string; reason: string };

// A card is about 360 pixels wide; smaller than this and a photo looks soft even there.
const MIN_WIDTH = 480;
const MIN_HEIGHT = 320;
const PLAIN_SPREAD = 12;
// Linked straight from the operator's site, so the file is what a traveller's phone downloads.
const HEAVIEST = 6 * 1024 * 1024;
const WIDEST = { trip: 2.6, hero: 3.2 };
// Fingerprints that differ in this many of their 64 points or fewer are the same photo.
const SAME_PHOTO = 5;

export function photoProblem(url: string, measure: PhotoFinding | undefined, role: "trip" | "hero"): string | null {
  if (measure === "blocked") return null;
  if (!measure || measure === "missing") return "would not load";
  const { width, height, spread } = measure;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return `too small (${width} by ${height})`;
  if (measure.bytes && measure.bytes > HEAVIEST) return `too heavy to load quickly (${Math.round(measure.bytes / 1024 / 1024)} MB)`;
  if (spread < PLAIN_SPREAD) return "almost one plain colour, a page background rather than a photo";
  if (width / height > WIDEST[role]) return "a wide website banner, which crops badly";
  if (/screen[\s_-]?shot/i.test(decodeURIComponent(url))) return "a screenshot";
  return null;
}

// Above this a photo is slow to arrive on a phone, so it is not put first.
const LIGHT = 1.5 * 1024 * 1024;

/**
 * How good a photo is to lead with: big, landscape, full of detail and quick to load.
 * Portraits crop badly into a card, a near-plain photo reads as a background, and a heavy
 * original leaves the first tile empty while it arrives. A photo the site would not let
 * us measure scores nothing, so it follows every measured one.
 */
export function photoScore(measure: PhotoFinding | undefined): number {
  if (!measure || typeof measure !== "object") return 0;
  const { width, height, spread, bytes } = measure;
  const size = Math.min(width, 2400) * Math.min(height, 1600) / 1_000_000;
  const shape = width >= height ? 1 : 0.6;
  const detail = Math.min(Math.max(spread / 40, 0.5), 1.2);
  const weight = bytes && bytes > LIGHT ? Math.max(LIGHT / bytes, 0.3) : 1;
  return size * shape * detail * weight;
}

/**
 * Whether two fingerprints are the same photo. A fingerprint is the photo shrunk to nine by
 * eight grey points, each row read as whether brightness rises or falls from point to point:
 * it survives resizing and re-saving, which is how sites end up with one photo at many
 * addresses.
 */
export function samePhoto(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let differ = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); x; x >>= 1) differ += x & 1;
  }
  return differ <= SAME_PHOTO;
}

/**
 * Each copy of a photo mapped to the best copy on the page: one that passes its checks,
 * then the biggest. Galleries then never show a photo twice, and trips sharing a photo
 * share one file.
 */
export function bestCopies(urls: string[], measured: Map<string, PhotoFinding>): Map<string, string> {
  const rank = (url: string) => (photoProblem(url, measured.get(url), "trip") ? 0 : 1_000_000) + photoScore(measured.get(url));
  const originals: { url: string; print: string }[] = [];
  const copies = new Map<string, string>();
  for (const url of [...new Set(urls)].sort((a, b) => rank(b) - rank(a))) {
    const found = measured.get(url);
    const print = typeof found === "object" ? found.print : undefined;
    if (!print) continue;
    const original = originals.find((o) => samePhoto(o.print, print));
    if (original) copies.set(url, original.url);
    else originals.push({ url, print });
  }
  return copies;
}

/**
 * The page as it will be imported: every trip keeps only its photos that passed, best
 * first and without repeats, and a hero that failed is swapped for the best trip photo.
 * What was left out is recorded, so the check screen can show it.
 */
export function applyPhotoChecks(op: PreparedOperator, measured: Map<string, PhotoFinding>): PreparedOperator {
  const verdict = (url: string, role: "trip" | "hero") => photoProblem(url, measured.get(url), role);
  const unmeasured = (urls: string[]) => urls.filter((u) => measured.get(u) === "blocked");
  const copies = bestCopies([op.heroImage, ...(op.gallery ?? []), ...op.trips.flatMap((t) => t.images ?? [])].filter((u): u is string => Boolean(u)), measured);
  const bestCopy = (url: string) => copies.get(url) ?? url;

  const trips = op.trips.map((trip) => {
    const kept: string[] = [];
    const leftOut: LeftOutPhoto[] = [];
    for (const url of (trip.images ?? []).map(bestCopy)) {
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

  // The page gallery is checked and ordered the same way as a trip's photos.
  const gallery: string[] = [];
  const pageLeftOut: LeftOutPhoto[] = [];
  for (const url of (op.gallery ?? []).map(bestCopy)) {
    if (gallery.includes(url) || pageLeftOut.some((l) => l.url === url)) continue;
    const reason = verdict(url, "trip");
    if (reason) pageLeftOut.push({ url, reason }); else gallery.push(url);
  }
  gallery.sort((a, b) => photoScore(measured.get(b)) - photoScore(measured.get(a)));
  // A logo is small and often plain by design, so it is only checked to load.
  const logo = op.logo && measured.get(op.logo) !== "missing" ? op.logo : null;

  const { photosLeftOut: _previous, ...rest } = op;
  const media = { ...(op.gallery ? { gallery } : {}), ...(op.logo !== undefined ? { logo } : {}) };
  // The operator's own hero stays unless it fails; with none, or a failed one, their best photo leads.
  const hero = op.heroImage ? bestCopy(op.heroImage) : null;
  const heroReason = hero ? verdict(hero, "hero") : null;
  if (hero && !heroReason) {
    return { ...rest, ...media, heroImage: hero, trips, ...(pageLeftOut.length ? { photosLeftOut: pageLeftOut } : {}) };
  }
  const best = [...trips.flatMap((t) => t.images), ...gallery].sort((a, b) => photoScore(measured.get(b)) - photoScore(measured.get(a)))[0] ?? null;
  const leftOut = [...(hero && heroReason ? [{ url: hero, reason: heroReason }] : []), ...pageLeftOut];
  return { ...rest, ...media, heroImage: best, trips, ...(leftOut.length ? { photosLeftOut: leftOut } : {}) };
}

/** Every photo a page uses, once. */
export function photosOf(op: PreparedOperator): string[] {
  return [...new Set([op.heroImage, op.logo, ...(op.gallery ?? []), ...op.trips.flatMap((t) => t.images ?? [])].filter((u): u is string => Boolean(u)))];
}
