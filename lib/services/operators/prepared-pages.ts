import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { uniqueListingSlug } from "@/lib/services/channels/listings";
import { mainPrice } from "@/lib/services/operators/main-price";
import {
  applyPageEdits, applyTripEdits, pageEditsFrom, tripEditsFrom, type PageEdits, type TripEdits,
} from "@/lib/services/operators/prepared-edits";
import type { LeftOutPhoto } from "@/lib/services/operators/photo-check";
import { pageStaleSigns, staleSigns } from "@/lib/services/operators/stale-signs";

/**
 * Operator pages Bluepass prepares from what an operator already publishes about their
 * own trips, before they have signed up. Nothing reaches a traveller until a person has
 * checked it against the source: the page and every trip on it carry their own check,
 * and only approved trips on an approved page are shown.
 *
 * The facts are the operator's (prices, times, places, inclusions), copied exactly, each
 * with the page it was read from. The words are Bluepass's, written fresh. The trips are
 * held as Rezdy trips with no product code yet: they become bookable on Bluepass when
 * the operator connects Rezdy, and until then the page sends travellers to the
 * operator's own booking link.
 *
 * The photos stay on the operator's own website and are linked, not copied. Travellers
 * see none of them until the operator has claimed the page and approved which ones show.
 */

export type PreparedPrice = { label: string; amount: number; currency: string; note?: string | null };
export type PreparedOffer = { text: string; conditions?: string | null; validUntil?: string | null; sourceUrl?: string | null };

export type PreparedTrip = {
  title: string;
  kind: string;
  summary: string;
  highlights?: string[];
  duration?: string | null;
  durationMinutes?: number | null;
  departureTimes?: string[];
  season?: string | null;
  departsFrom?: string | null;
  prices?: PreparedPrice[];
  /** The main activity's adult price (main-price.ts), set on import; the researcher's guess is replaced. */
  priceFrom?: number | null;
  /** Which line of `prices` the From price is, so the person checking can see it. */
  priceFromLabel?: string | null;
  includes?: string[];
  bring?: string[];
  requirements?: string | null;
  offer?: PreparedOffer | null;
  images?: string[];
  bookingLinks?: string[];
  sourceUrl: string;
  checkNotes?: string | null;
  /** Photos the importer left out, and why, and those it could not measure (see photo-check.ts). */
  photosLeftOut?: LeftOutPhoto[];
  photosUnmeasured?: string[];
};

export type PreparedOperator = {
  slug: string;
  name: string;
  website: string;
  rezdyAlias?: string | null;
  state?: string | null;
  town?: string | null;
  category?: string | null;
  summary: string;
  standouts?: string[];
  contact?: { phone?: string | null; email?: string | null; address?: string | null };
  heroImage?: string | null;
  sourceUrls?: string[];
  trips: PreparedTrip[];
  offers?: PreparedOffer[];
  checkNotes?: string | null;
  photosLeftOut?: LeftOutPhoto[];
};

export type QcStatus = "pending" | "approved" | "needs_fix";
export type TripCheck = { status: QcStatus; notes: string | null; reviewedBy: string | null; reviewedAt: string | null };
/** What a prepared trip keeps in OperatorListing.channelData. */
export type PreparedTripData = {
  source: "operator-website";
  /** The trip as read off the operator's website. */
  page: PreparedTrip;
  /** Corrections made while checking, laid over `page` when shown (prepared-edits.ts). */
  edits?: TripEdits | null;
  editedBy?: string | null;
  editedAt?: string | null;
  qc: TripCheck;
  importedAt: string;
  /**
   * The operator's own Rezdy trip this one books through, once they have claimed the page
   * and connected Rezdy (prepared-booking.ts). `listingId: null` is the operator saying it
   * is not on Rezdy.
   */
  booking?: { listingId: string | null; by: "name" | "operator"; at: string } | null;
};

const PLACEHOLDER_DOMAIN = "ops.bluepass.co";
export const NOT_YET_BOOKABLE = "Bookable on Bluepass once the operator connects Rezdy.";

const KIND_LABEL: Record<string, string> = {
  cruise: "Cruise", tour: "Tour", swim: "Swim", dive: "Dive", snorkel: "Snorkel", kayak: "Kayak",
  sail: "Sailing", charter: "Charter", liveaboard: "Liveaboard", course: "Course", other: "Tour",
};

function tripData(listing: { channelData: Prisma.JsonValue | null }): PreparedTripData | null {
  const data = listing.channelData as Partial<PreparedTripData> | null;
  return data?.source === "operator-website" && data.page ? (data as PreparedTripData) : null;
}

export function preparedTrip(listing: { channelData: Prisma.JsonValue | null }) {
  return tripData(listing);
}

/** The few checks a page cannot go out without, so a fact-checker sees them first. */
export function validatePrepared(op: PreparedOperator): string[] {
  const problems: string[] = [];
  if (!op.slug || !/^[a-z0-9-]+$/.test(op.slug)) problems.push("slug is missing or not kebab-case");
  if (!op.name?.trim()) problems.push("name is missing");
  if (!op.summary?.trim()) problems.push("summary is missing");
  if (!Array.isArray(op.trips) || op.trips.length === 0) problems.push("no trips");
  // Bluepass's own words never carry an em dash; the operator's names for things are left as they wrote them.
  const ours = [op.summary, ...(op.standouts ?? []), ...(op.trips ?? []).flatMap((t) => [t.summary, ...(t.highlights ?? [])])].join(" ");
  if (ours.includes("\u2014")) problems.push("Bluepass's own wording contains an em dash");
  for (const t of op.trips ?? []) {
    if (!t.title?.trim()) problems.push("a trip has no title");
    if (!t.sourceUrl) problems.push(`"${t.title}" has no source page`);
  }
  return problems;
}

/**
 * What a check approves: everything but the photos. Photos come and go with the operator's
 * website and its bot rules, and travellers see only the ones the operator approves, so a
 * photo changing must not send checked facts back to waiting.
 */
function factsOf<T extends { images?: string[]; heroImage?: string | null; photosLeftOut?: unknown; photosUnmeasured?: unknown }>(item: T) {
  const { images: _i, heroImage: _h, photosLeftOut: _l, photosUnmeasured: _u, ...facts } = item;
  return stableJson(facts);
}

/** JSON with object keys in a fixed order. Postgres stores JSON with its keys reordered, so plain text would never match the file. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The listing columns other parts of Bluepass read, from the trip as shown. */
function listingFields(trip: PreparedTrip, region: string, heroImage: string | null | undefined) {
  const currency = trip.prices?.find((p) => p.label === trip.priceFromLabel)?.currency || trip.prices?.[0]?.currency || "AUD";
  return {
    title: trip.title.trim().slice(0, 160),
    category: KIND_LABEL[trip.kind] ?? "Tour",
    region,
    description: trip.summary.trim(),
    heroImageUrl: trip.images?.[0] ?? heroImage ?? null,
    priceFrom: trip.priceFrom ?? null,
    priceSignal: trip.priceFrom ? `From ${currency} ${trip.priceFrom}` : null,
    currency,
    durationMinutes: trip.durationMinutes ?? null,
    meetingPoint: trip.departsFrom ?? null,
  };
}

/** Brings one operator's prepared page in, or up to date. A trip whose facts changed goes back to waiting for a check. */
export async function importPreparedOperator(op: PreparedOperator, now = new Date()) {
  const problems = validatePrepared(op);
  if (problems.length) return { ok: false as const, slug: op.slug, problems };

  const region = [op.town, op.state].filter(Boolean).join(", ") || "Australia";
  await prisma.operatorLead.upsert({
    where: { slug: op.slug },
    create: {
      slug: op.slug, name: op.name, category: op.category ?? null, region, websiteUrl: op.website,
      email: op.contact?.email ?? null, phone: op.contact?.phone ?? null, source: "prepared-page",
    },
    update: { name: op.name, category: op.category ?? null, region, websiteUrl: op.website },
  });

  // The trips need an owner. Until the operator claims the page it is a placeholder
  // account nobody can sign in to, the same arrangement the Rezdy Discover sync uses.
  const email = `prebuilt+${op.slug}@${PLACEHOLDER_DOMAIN}`;
  const account = await prisma.bluePassAccount.upsert({
    where: { email },
    create: { email, passwordHash: randomBytes(32).toString("hex"), displayName: op.name, roles: ["OPERATOR"] },
    update: { displayName: op.name },
  });
  const profile = await prisma.operatorProfile.upsert({
    where: { accountId: account.id },
    create: {
      accountId: account.id, status: "PENDING_REVIEW", companyName: op.name, websiteUrl: op.website,
      claimedOperatorSlug: op.slug, country: "AU",
      notes: `Placeholder for a page prepared from the operator's own website on ${now.toISOString().slice(0, 10)}. Not a real sign-in.`,
    },
    update: { companyName: op.name, websiteUrl: op.website, claimedOperatorSlug: op.slug },
  });

  const { trips, ...operatorData } = op;
  const existingPage = await prisma.preparedOperatorPage.findUnique({ where: { slug: op.slug } });
  const pageChanged = !existingPage || factsOf(existingPage.data as unknown as PreparedOperator) !== factsOf(operatorData as PreparedOperator);
  await prisma.preparedOperatorPage.upsert({
    where: { slug: op.slug },
    create: { slug: op.slug, data: operatorData as unknown as Prisma.InputJsonValue, importedAt: now },
    update: {
      data: operatorData as unknown as Prisma.InputJsonValue,
      importedAt: now,
      ...(pageChanged ? { qcStatus: "pending", qcNotes: existingPage?.qcNotes ? `Changed on re-import. Earlier note: ${existingPage.qcNotes}` : null } : {}),
    },
  });

  const counts = { created: 0, updated: 0, unchanged: 0, removed: 0 };
  const seen: string[] = [];
  // Matched on the title the website gives, which a correction to the shown title does not change.
  const held = await prisma.operatorListing.findMany({ where: { operatorProfileId: profile.id } });
  const byWebsiteTitle = new Map(held.flatMap((l) => {
    const d = tripData(l);
    return d ? [[d.page.title, l] as const] : [];
  }));
  for (const researched of trips) {
    const main = mainPrice(researched.prices);
    const trip: PreparedTrip = { ...researched, priceFrom: main?.amount ?? null, priceFromLabel: main?.label ?? null };
    const existing = byWebsiteTitle.get(trip.title) ?? null;
    const before = existing ? tripData(existing) : null;
    const shown = applyTripEdits(trip, before?.edits);
    const changed = !before || factsOf(before.page) !== factsOf(trip);
    const qc: TripCheck = changed
      ? { status: "pending", notes: before?.qc.notes ? `Changed on re-import. Earlier note: ${before.qc.notes}` : null, reviewedBy: null, reviewedAt: null }
      : before!.qc;
    const fields = {
      ...listingFields(shown, region, op.heroImage),
      channel: "REZDY" as const,
      channelIssue: NOT_YET_BOOKABLE,
      channelData: {
        source: "operator-website", page: trip, edits: before?.edits ?? null, editedBy: before?.editedBy ?? null, editedAt: before?.editedAt ?? null,
        qc, importedAt: now.toISOString(), booking: before?.booking ?? null,
      } as unknown as Prisma.InputJsonValue,
    };
    if (existing) {
      // A trip back on the website after leaving it returns as a draft.
      const back = existing.status === "ARCHIVED" ? { status: "DRAFT" as const, archivedAt: null, archivedBy: null, archivedReason: null } : {};
      await prisma.operatorListing.update({ where: { id: existing.id }, data: { ...fields, ...back } });
      seen.push(existing.id);
      if (changed) counts.updated += 1; else counts.unchanged += 1;
    } else {
      const created = await prisma.operatorListing.create({
        data: { ...fields, operatorProfileId: profile.id, slug: await uniqueListingSlug(`${op.slug} ${trip.title}`), status: "DRAFT" },
      });
      seen.push(created.id);
      counts.created += 1;
    }
  }
  // A trip no longer on the operator's site leaves the page.
  const gone = await prisma.operatorListing.updateMany({
    where: { operatorProfileId: profile.id, id: { notIn: seen }, status: { not: "ARCHIVED" } },
    data: { status: "ARCHIVED", archivedAt: now, archivedBy: "prepared-page import", archivedReason: "No longer on the operator's website." },
  });
  counts.removed = gone.count;
  return { ok: true as const, slug: op.slug, ...counts };
}

/** The placeholder profile that holds a prepared page's trips until, and after, it is claimed. */
export async function placeholderProfileFor(slug: string) {
  return prisma.operatorProfile.findFirst({
    where: { claimedOperatorSlug: slug, account: { email: `prebuilt+${slug}@${PLACEHOLDER_DOMAIN}` } },
    select: { id: true },
  });
}

export type PhotoApproval = { approved: string[]; seen: string[]; approvedAt: Date | null; approvedBy: string | null };

export type LoadedPage = {
  slug: string;
  lead: { name: string; claimed: boolean };
  page: PreparedOperator & { qcStatus: QcStatus; qcNotes: string | null };
  /** `trip` is as shown, corrections included; `website` is as read off the operator's site. */
  trips: {
    id: string; slug: string; status: string; check: TripCheck; trip: PreparedTrip; website: PreparedTrip; edits: TripEdits | null; editedBy: string | null;
    /** The operator's Rezdy trip this one books through, when it is on sale. */
    bookable: { slug: string; title: string; priceFrom: number | null; currency: string } | null;
  }[];
  photos: PhotoApproval;
  /** The page as read off the website, and the corrections laid over it. */
  website: PreparedOperator;
  edits: PageEdits | null;
  editedBy: string | null;
};

/** Keeps only the photos the operator approved; the rest are not shown to travellers. */
function approvedPhotosOnly(page: PreparedOperator, trips: LoadedPage["trips"], approved: string[]) {
  const ok = new Set(approved);
  return {
    page: { ...page, heroImage: page.heroImage && ok.has(page.heroImage) ? page.heroImage : null },
    trips: trips.map((t) => ({ ...t, trip: { ...t.trip, images: (t.trip.images ?? []).filter((u) => ok.has(u)) } })),
  };
}

/**
 * One prepared page. For travellers, only an approved page with its approved trips; for
 * the person checking it, everything, with each item's check.
 */
export async function loadPreparedPage(slug: string, opts: { preview?: boolean; travellerPhotos?: boolean } = {}): Promise<LoadedPage | null> {
  const [page, lead, profile] = await Promise.all([
    prisma.preparedOperatorPage.findUnique({ where: { slug } }),
    prisma.operatorLead.findUnique({ where: { slug }, select: { name: true, status: true } }),
    placeholderProfileFor(slug),
  ]);
  if (!page || !lead || !profile) return null;
  if (!opts.preview && page.qcStatus !== "approved") return null;
  const listings = await prisma.operatorListing.findMany({
    where: { operatorProfileId: profile.id, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "asc" },
  });
  const held = listings
    .map((l) => ({ l, d: tripData(l) }))
    .filter((x): x is { l: (typeof listings)[number]; d: PreparedTripData } => Boolean(x.d))
    .filter((x) => opts.preview || x.d.qc.status === "approved");
  const linked = held.map((x) => x.d.booking?.listingId).filter((id): id is string => Boolean(id));
  const selling = new Map((linked.length
    ? await prisma.operatorListing.findMany({ where: { id: { in: linked }, status: "LIVE", channelIssue: null }, select: { id: true, slug: true, title: true, priceFrom: true, currency: true } })
    : []).map((l) => [l.id, l]));
  const all = held.map(({ l, d }) => {
    const sells = d.booking?.listingId ? selling.get(d.booking.listingId) : undefined;
    return {
      id: l.id, slug: l.slug, status: l.status, check: d.qc,
      trip: applyTripEdits(d.page, d.edits), website: d.page, edits: d.edits ?? null, editedBy: d.editedBy ?? null,
      bookable: sells ? { slug: sells.slug, title: sells.title, priceFrom: sells.priceFrom ? Number(sells.priceFrom) : null, currency: sells.currency } : null,
    };
  });
  const website = page.data as unknown as PreparedOperator;
  const pageEdits = (page.edits as PageEdits | null) ?? null;
  const data = applyPageEdits(website, pageEdits);
  const photos: PhotoApproval = { approved: page.photosApproved, seen: page.photosSeen, approvedAt: page.photosApprovedAt, approvedBy: page.photosApprovedBy };
  // The person checking the page sees every photo, unless they ask to see it as a traveller
  // would; a traveller sees only the ones the operator approved.
  const shown = opts.preview && !opts.travellerPhotos ? { page: data, trips: all } : approvedPhotosOnly(data, all, page.photosApproved);
  return {
    slug,
    lead: { name: lead.name, claimed: lead.status === "APPROVED" || lead.status === "LIVE" },
    page: { ...shown.page, trips: [], qcStatus: page.qcStatus as QcStatus, qcNotes: page.qcNotes },
    trips: shown.trips,
    photos,
    website,
    edits: pageEdits,
    editedBy: page.editedBy,
  };
}

/** Every photo on a prepared page, once, with where it appears. */
export function photosOnPage(loaded: Pick<LoadedPage, "page" | "trips">) {
  const found = new Map<string, string[]>();
  const add = (url: string | null | undefined, where: string) => {
    if (!url) return;
    found.set(url, [...(found.get(url) ?? []), where]);
  };
  add(loaded.page.heroImage, "Top of the page");
  for (const { trip } of loaded.trips) for (const url of trip.images ?? []) add(url, trip.title);
  return [...found.entries()].map(([url, where]) => ({ url, where: [...new Set(where)] }));
}

/** Whether this account has claimed a prepared page, for the operator nav. */
export async function hasClaimedPreparedPage(accountId: string) {
  const profile = await prisma.operatorProfile.findUnique({ where: { accountId }, select: { claimedOperatorSlug: true, account: { select: { email: true } } } });
  const slug = profile?.claimedOperatorSlug;
  if (!slug || profile.account.email === `prebuilt+${slug}@${PLACEHOLDER_DOMAIN}`) return false;
  return Boolean(await prisma.preparedOperatorPage.findUnique({ where: { slug }, select: { id: true } }));
}

/**
 * The prepared page an operator account has claimed, with the claim's state. Only an
 * approved claim can approve photos: a pending claimant has not been confirmed as the
 * business yet.
 */
export async function claimedPreparedPage(accountId: string) {
  const profile = await prisma.operatorProfile.findUnique({
    where: { accountId },
    select: { status: true, claimedOperatorSlug: true, account: { select: { email: true } } },
  });
  const slug = profile?.claimedOperatorSlug;
  if (!profile || !slug || profile.account.email === `prebuilt+${slug}@${PLACEHOLDER_DOMAIN}`) return null;
  const loaded = await loadPreparedPage(slug, { preview: true });
  if (!loaded) return null;
  const photos = photosOnPage(loaded);
  const approved = new Set(loaded.photos.approved);
  const seen = new Set(loaded.photos.seen);
  return {
    slug,
    name: loaded.page.name,
    claimApproved: profile.status === "APPROVED",
    pageLive: loaded.page.qcStatus === "approved",
    photos: photos.map((p) => ({ ...p, approved: approved.has(p.url), isNew: !seen.has(p.url) })),
    approvedAt: loaded.photos.approvedAt,
    /** Photos the operator has not been asked about yet. */
    undecided: photos.filter((p) => !seen.has(p.url)).length,
  };
}

/**
 * The operator correcting their own page. Allowed only for the page their approved claim
 * is for, and only for that page's trips; their word is the page's from then on.
 */
export async function operatorCorrectTrip(input: { accountId: string; listingId: string; form: Record<string, string> }) {
  const claimed = await claimedPreparedPage(input.accountId);
  if (!claimed?.claimApproved) return { ok: false as const, message: "You can correct your page once your claim is approved." };
  const loaded = await loadPreparedPage(claimed.slug, { preview: true });
  if (!loaded?.trips.some((t) => t.id === input.listingId)) return { ok: false as const, message: "That trip is not on your page." };
  const account = await prisma.bluePassAccount.findUnique({ where: { id: input.accountId }, select: { email: true } });
  return setTripEdits({ listingId: input.listingId, form: input.form, editor: `operator ${account?.email ?? input.accountId}` });
}

export async function operatorCorrectPage(input: { accountId: string; form: Record<string, string> }) {
  const claimed = await claimedPreparedPage(input.accountId);
  if (!claimed?.claimApproved) return { ok: false as const, message: "You can correct your page once your claim is approved." };
  const account = await prisma.bluePassAccount.findUnique({ where: { id: input.accountId }, select: { email: true } });
  return setPageEdits({ slug: claimed.slug, form: input.form, editor: `operator ${account?.email ?? input.accountId}` });
}

/** The operator chooses which of the page's photos travellers see. */
export async function approvePhotos(input: { accountId: string; keep: string[] }) {
  const claimed = await claimedPreparedPage(input.accountId);
  if (!claimed) return { ok: false as const, message: "There is no Bluepass page on your account." };
  if (!claimed.claimApproved) return { ok: false as const, message: "Your claim is still being checked. You can choose photos once it is approved." };
  const onPage = new Set(claimed.photos.map((p) => p.url));
  const keep = [...new Set(input.keep)].filter((u) => onPage.has(u));
  const account = await prisma.bluePassAccount.findUnique({ where: { id: input.accountId }, select: { email: true } });
  await prisma.preparedOperatorPage.update({
    where: { slug: claimed.slug },
    data: { photosApproved: keep, photosSeen: [...onPage], photosApprovedAt: new Date(), photosApprovedBy: account?.email ?? input.accountId },
  });
  return {
    ok: true as const,
    message: keep.length === 0 ? "Saved. Your page shows no photos." : `Saved. Travellers see ${keep.length} ${keep.length === 1 ? "photo" : "photos"}.`,
  };
}

export async function setTripCheck(input: { listingId: string; status: QcStatus; notes: string | null; reviewer: string }) {
  const listing = await prisma.operatorListing.findUnique({ where: { id: input.listingId } });
  const data = listing ? tripData(listing) : null;
  if (!listing || !data) return { ok: false as const, message: "That trip is not on a prepared page." };
  const qc: TripCheck = { status: input.status, notes: input.notes?.trim().slice(0, 1000) || null, reviewedBy: input.reviewer, reviewedAt: new Date().toISOString() };
  await prisma.operatorListing.update({
    where: { id: listing.id },
    data: { channelData: { ...data, qc } as unknown as Prisma.InputJsonValue },
  });
  return { ok: true as const, message: input.status === "approved" ? "Trip approved." : input.status === "needs_fix" ? "Marked as needing a fix." : "Back to waiting." };
}

export async function setPageCheck(input: { slug: string; status: QcStatus; notes: string | null; reviewer: string }) {
  const page = await prisma.preparedOperatorPage.findUnique({ where: { slug: input.slug } });
  if (!page) return { ok: false as const, message: "No prepared page with that address." };
  await prisma.preparedOperatorPage.update({
    where: { slug: input.slug },
    data: { qcStatus: input.status, qcNotes: input.notes?.trim().slice(0, 2000) || null, reviewedBy: input.reviewer, reviewedAt: new Date() },
  });
  return { ok: true as const, message: input.status === "approved" ? "Page approved. It shows its approved trips." : input.status === "needs_fix" ? "Page marked as needing a fix." : "Page back to waiting." };
}

/** Saves corrections to a trip, made while checking it against the website. */
export async function setTripEdits(input: { listingId: string; form: Record<string, string>; editor: string }) {
  const listing = await prisma.operatorListing.findUnique({ where: { id: input.listingId } });
  const data = listing ? tripData(listing) : null;
  if (!listing || !data) return { ok: false as const, message: "That trip is not on a prepared page." };
  const result = tripEditsFrom(data.page, input.form);
  if (!result.ok) return result;
  const edits = Object.keys(result.edits).length ? result.edits : null;
  const shown = applyTripEdits(data.page, edits);
  await prisma.operatorListing.update({
    where: { id: listing.id },
    data: {
      ...listingFields(shown, listing.region ?? "Australia", listing.heroImageUrl),
      channelData: { ...data, edits, editedBy: edits ? input.editor : null, editedAt: edits ? new Date().toISOString() : null } as unknown as Prisma.InputJsonValue,
    },
  });
  const count = edits ? Object.keys(edits).length : 0;
  return { ok: true as const, message: count ? `Saved ${count} ${count === 1 ? "correction" : "corrections"}. Approve the trip when it is right.` : "Saved. The trip matches the website again." };
}

/** Saves corrections to the operator part of a page: summary, standouts, contact. */
export async function setPageEdits(input: { slug: string; form: Record<string, string>; editor: string }) {
  const page = await prisma.preparedOperatorPage.findUnique({ where: { slug: input.slug } });
  if (!page) return { ok: false as const, message: "No prepared page with that address." };
  const result = pageEditsFrom(page.data as unknown as PreparedOperator, input.form);
  if (!result.ok) return result;
  const edits = Object.keys(result.edits).length ? result.edits : null;
  await prisma.preparedOperatorPage.update({
    where: { slug: input.slug },
    data: { edits: edits ? (edits as Prisma.InputJsonValue) : Prisma.DbNull, editedBy: edits ? input.editor : null, editedAt: edits ? new Date() : null },
  });
  return { ok: true as const, message: edits ? "Saved. Approve the page when it is right." : "Saved. The page matches the website again." };
}

/**
 * Approves every trip on a page that is still waiting, after the person checking has read
 * them. Trips marked as needing a fix stay as they are, and so do trips the automatic
 * check thinks are out of date: those need a look of their own.
 */
export async function approveWaitingTrips(input: { slug: string; reviewer: string }) {
  const loaded = await loadPreparedPage(input.slug, { preview: true });
  if (!loaded) return { ok: false as const, message: "No prepared page with that address." };
  const waiting = loaded.trips.filter((t) => t.check.status === "pending");
  const dated = waiting.filter((t) => staleSigns(t.trip).length);
  const ready = waiting.filter((t) => !staleSigns(t.trip).length);
  for (const t of ready) await setTripCheck({ listingId: t.id, status: "approved", notes: null, reviewer: input.reviewer });
  const left = dated.length ? ` ${dated.length} that ${dated.length === 1 ? "looks" : "look"} out of date ${dated.length === 1 ? "is" : "are"} still waiting.` : "";
  return { ok: true as const, message: `Approved ${ready.length} ${ready.length === 1 ? "trip" : "trips"}.${left}` };
}

/** The next page in the queue that still needs a decision, after this one. */
export async function nextPageToCheck(after: string) {
  const pages = await prisma.preparedOperatorPage.findMany({ where: { qcStatus: { not: "approved" } }, orderBy: { slug: "asc" }, select: { slug: true } });
  return (pages.find((p) => p.slug > after) ?? pages.find((p) => p.slug !== after))?.slug ?? null;
}

/** The checking queue: every prepared page with how far its check has got and what to look at first. */
export async function preparedPagesOverview() {
  const pages = await prisma.preparedOperatorPage.findMany({ orderBy: { slug: "asc" } });
  return Promise.all(pages.map(async (p) => {
    const loaded = await loadPreparedPage(p.slug, { preview: true });
    const trips = loaded?.trips ?? [];
    const data = p.data as unknown as PreparedOperator;
    const flags: string[] = [];
    if (data.checkNotes) flags.push("operator note");
    const dated = trips.filter((t) => staleSigns(t.trip).length).length + (pageStaleSigns(data.offers).length ? 1 : 0);
    if (dated) flags.push(`${dated} out of date`);
    const noPrice = trips.filter((t) => !t.trip.prices?.length).length;
    if (noPrice) flags.push(`${noPrice} without prices`);
    const noImage = trips.filter((t) => !t.trip.images?.length).length;
    if (noImage) flags.push(`${noImage} without photos`);
    const leftOut = (data.photosLeftOut?.length ?? 0) + trips.reduce((n, t) => n + (t.trip.photosLeftOut?.length ?? 0), 0);
    if (leftOut) flags.push(`${leftOut} ${leftOut === 1 ? "photo" : "photos"} left out`);
    const unmeasured = new Set(trips.flatMap((t) => t.trip.photosUnmeasured ?? [])).size;
    if (unmeasured) flags.push(`${unmeasured} ${unmeasured === 1 ? "photo" : "photos"} to judge by eye`);
    const noted = trips.filter((t) => t.trip.checkNotes).length;
    if (noted) flags.push(`${noted} with notes`);
    return {
      slug: p.slug,
      name: data.name,
      where: [data.town, data.state].filter(Boolean).join(", "),
      website: data.website,
      qcStatus: p.qcStatus as QcStatus,
      trips: trips.length,
      approved: trips.filter((t) => t.check.status === "approved").length,
      needsFix: trips.filter((t) => t.check.status === "needs_fix").length,
      flags,
      importedAt: p.importedAt,
    };
  }));
}
