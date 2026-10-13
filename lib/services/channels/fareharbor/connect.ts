import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ChannelResult } from "@/lib/services/channels/rezdy/sync";
import { uniqueListingSlug } from "@/lib/services/channels/listings";
import {
  fareHarborAffiliate,
  fareHarborBookingUrl,
  fareHarborLightframe,
  parseFareHarborLink,
  type FareHarborLink,
} from "@/lib/services/channels/fareharbor/links";
import { operatorListingInputSchema } from "@/lib/services/operators/operator-listing-service";
import { newBookingReference } from "@/lib/services/rails/reference";

/**
 * An operator's FareHarbor, connected through the one thing FareHarbor offers an
 * affiliate: the booking link it generates with Bluepass as the affiliate. The link
 * names their account; each trip's link names the trip. Bluepass never holds their
 * seats or their money; it sends travellers to their checkout, tagged.
 */

function notOurs(link: FareHarborLink, affiliate: string) {
  return !link.asn || link.asn !== affiliate;
}

async function ownConnection(operatorProfileId: string) {
  return prisma.operatorChannelConnection.findUnique({
    where: { operatorProfileId_platform: { operatorProfileId, platform: "FAREHARBOR" } },
  });
}

/** Records the account the link belongs to. Connected once a link carries Bluepass's affiliate tag. */
/** An IANA zone the runtime knows, or null. */
function validZone(zone: string | null | undefined) {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/**
 * Records the account the link belongs to. Connected once a link carries Bluepass's
 * affiliate tag. `timezone` is the operator's own, read from their browser when they
 * connect: FareHarbor's report gives times in the operator's local time and says
 * nothing about which zone that is.
 */
async function upsertConnection(operatorProfileId: string, link: FareHarborLink, affiliate: string, timezone?: string | null) {
  const taken = await prisma.operatorChannelConnection.findUnique({
    where: { platform_accountKey: { platform: "FAREHARBOR", accountKey: link.shortname } },
  });
  if (taken && taken.operatorProfileId !== operatorProfileId) {
    return { ok: false as const, message: "That FareHarbor account is already connected to another Bluepass operator." };
  }
  const tagged = !notOurs(link, affiliate);
  const existing = await ownConnection(operatorProfileId);
  if (existing && existing.accountKey !== link.shortname && existing.status === "CONNECTED") {
    return { ok: false as const, message: `Your Bluepass account is connected to the FareHarbor account "${existing.accountKey}". Disconnect it first to use "${link.shortname}".` };
  }
  const connection = await prisma.operatorChannelConnection.upsert({
    where: { operatorProfileId_platform: { operatorProfileId, platform: "FAREHARBOR" } },
    create: {
      operatorProfileId,
      platform: "FAREHARBOR",
      accountKey: link.shortname,
      displayName: link.shortname,
      timezone: validZone(timezone),
      status: tagged ? "CONNECTED" : "WAITING",
      lastCheckedAt: new Date(),
      lastError: tagged ? null : "This link does not carry Bluepass's affiliate tag yet.",
    },
    update: {
      accountKey: link.shortname,
      ...(validZone(timezone) && !existing?.timezone ? { timezone: validZone(timezone) } : {}),
      ...(tagged ? { status: "CONNECTED" as const, lastError: null } : {}),
      lastCheckedAt: new Date(),
    },
  });
  return { ok: true as const, connection, tagged };
}

export async function connectFareHarbor(input: { operatorProfileId: string; link: string; timezone?: string | null }): Promise<ChannelResult> {
  const affiliate = fareHarborAffiliate();
  if (!affiliate) return { ok: false, message: "Bluepass's FareHarbor affiliate account is not set up yet, so FareHarbor trips cannot be sold here." };
  const link = parseFareHarborLink(input.link);
  if (!link) return { ok: false, message: "That is not a FareHarbor link. Paste the link FareHarbor gives you under Book Buttons & Embeds." };
  const saved = await upsertConnection(input.operatorProfileId, link, affiliate, input.timezone);
  if (!saved.ok) return saved;
  if (!saved.tagged) {
    return { ok: true, message: `Found ${link.shortname} on FareHarbor. The link is not tagged for Bluepass yet: follow the steps below, then paste the new link.` };
  }
  return { ok: true, message: `Connected ${link.shortname} on FareHarbor. Paste a trip's link on that trip to sell it here.` };
}

export async function disconnectFareHarbor(operatorProfileId: string): Promise<ChannelResult> {
  const connection = await ownConnection(operatorProfileId);
  if (!connection) return { ok: true, message: "FareHarbor was not connected." };
  await prisma.$transaction([
    prisma.operatorListing.updateMany({
      where: { operatorProfileId, channel: "FAREHARBOR" },
      data: { channelIssue: "FareHarbor is disconnected. Connect it again to sell this trip." },
    }),
    prisma.operatorChannelConnection.delete({ where: { id: connection.id } }),
  ]);
  return { ok: true, message: "FareHarbor disconnected. Your FareHarbor trips have stopped selling on Bluepass." };
}

function checkTripLink(raw: string, affiliate: string, accountKey: string | null): { ok: true; link: FareHarborLink } | { ok: false; message: string } {
  const link = parseFareHarborLink(raw);
  if (!link) return { ok: false, message: "That is not a FareHarbor link." };
  if (!link.itemId) return { ok: false, message: "That link opens your whole FareHarbor page. Make the book button for one trip and paste that link." };
  if (accountKey && link.shortname !== accountKey) {
    return { ok: false, message: `That trip belongs to the FareHarbor account "${link.shortname}", not "${accountKey}".` };
  }
  if (notOurs(link, affiliate)) {
    return { ok: false, message: "This link does not carry Bluepass's affiliate tag. Set ASN company to Bluepass under Advanced settings and copy the link again." };
  }
  return { ok: true, link };
}

function linkData(link: FareHarborLink, affiliate: string) {
  return {
    channel: "FAREHARBOR" as const,
    externalProductId: link.itemId,
    externalBookingUrl: fareHarborBookingUrl(link, { asn: affiliate }),
    channelData: { link } as unknown as Prisma.InputJsonValue,
    channelSyncedAt: new Date(),
    channelIssue: null,
  };
}

/**
 * Sells an existing trip through FareHarbor. Its story and photos stay as written on
 * Bluepass; its dates, prices and checkout become FareHarbor's. A trip that already
 * sells on Bluepass's own calendar cannot switch while it has bookings ahead.
 */
export async function linkFareHarborTrip(input: { operatorProfileId: string; listingId: string; link: string }): Promise<ChannelResult> {
  const affiliate = fareHarborAffiliate();
  if (!affiliate) return { ok: false, message: "Bluepass's FareHarbor affiliate account is not set up yet." };
  const listing = await prisma.operatorListing.findUnique({ where: { id: input.listingId }, select: { operatorProfileId: true, channel: true } });
  if (!listing || listing.operatorProfileId !== input.operatorProfileId) return { ok: false, message: "That trip is not one of yours." };
  if (listing.channel === "REZDY") return { ok: false, message: "This trip comes from Rezdy, so it books through Rezdy." };

  const connection = await ownConnection(input.operatorProfileId);
  const checked = checkTripLink(input.link, affiliate, connection?.accountKey ?? null);
  if (!checked.ok) return checked;
  const saved = await upsertConnection(input.operatorProfileId, checked.link, affiliate);
  if (!saved.ok) return saved;

  const ahead = await prisma.listingBooking.count({
    where: { listingId: input.listingId, channel: "NATIVE", status: { in: ["CONFIRMED", "PENDING_PAYMENT"] }, departsAt: { gt: new Date() } },
  });
  if (ahead > 0) {
    return { ok: false, message: `This trip has ${ahead} ${ahead === 1 ? "booking" : "bookings"} ahead on Bluepass's calendar. Switch it once they have run, or make a new trip for FareHarbor.` };
  }
  await prisma.$transaction([
    prisma.listingSchedule.updateMany({ where: { listingId: input.listingId }, data: { active: false } }),
    prisma.operatorListing.update({ where: { id: input.listingId }, data: linkData(checked.link, affiliate) }),
  ]);
  return { ok: true, message: "This trip now books through your FareHarbor checkout, tagged as Bluepass's." };
}

/** Back to Bluepass's own calendar: the trip needs a schedule and prices before it sells again. */
export async function unlinkFareHarborTrip(input: { operatorProfileId: string; listingId: string }): Promise<ChannelResult> {
  const listing = await prisma.operatorListing.findUnique({ where: { id: input.listingId }, select: { operatorProfileId: true, channel: true } });
  if (!listing || listing.operatorProfileId !== input.operatorProfileId || listing.channel !== "FAREHARBOR") {
    return { ok: false, message: "That trip does not book through FareHarbor." };
  }
  await prisma.operatorListing.update({
    where: { id: input.listingId },
    data: { channel: "NATIVE", externalProductId: null, externalBookingUrl: null, channelData: Prisma.DbNull, channelIssue: null },
  });
  return { ok: true, message: "This trip no longer books through FareHarbor. Give it a schedule and a price to sell it on Bluepass's calendar." };
}

/**
 * A new trip that books through FareHarbor, in one step: the link, and the few words
 * and one photo a traveller decides on. It goes live at once; FareHarbor has the
 * dates and prices, so there is nothing else to set up.
 */
export async function addFareHarborTrip(input: {
  operatorProfileId: string;
  link: string;
  title: string;
  region: string;
  description: string;
  heroImageUrl?: string;
  priceFrom?: string | number;
  currency?: string;
  durationMinutes?: number | null;
  meetingPoint?: string | null;
  timezone?: string | null;
}): Promise<ChannelResult & { listingId?: string }> {
  const affiliate = fareHarborAffiliate();
  if (!affiliate) return { ok: false, message: "Bluepass's FareHarbor affiliate account is not set up yet." };
  const connection = await ownConnection(input.operatorProfileId);
  const checked = checkTripLink(input.link, affiliate, connection?.accountKey ?? null);
  if (!checked.ok) return checked;
  const duplicate = await prisma.operatorListing.findFirst({
    where: { operatorProfileId: input.operatorProfileId, channel: "FAREHARBOR", externalProductId: checked.link.itemId },
    select: { title: true },
  });
  if (duplicate) return { ok: false, message: `That FareHarbor trip is already on Bluepass as "${duplicate.title}".` };

  const parsed = operatorListingInputSchema.safeParse({
    title: input.title,
    category: "Tour",
    region: input.region,
    description: input.description,
    heroImageUrl: input.heroImageUrl || undefined,
    priceFrom: input.priceFrom === "" ? undefined : input.priceFrom,
    currency: input.currency || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? "");
    const words: Record<string, string> = {
      title: "Give the trip a name.",
      region: "Say where it runs.",
      description: "Describe the trip in a sentence or two.",
      priceFrom: "The from price has to be a number.",
    };
    return { ok: false, message: words[field] ?? "Check the trip details and try again." };
  }
  const saved = await upsertConnection(input.operatorProfileId, checked.link, affiliate, input.timezone);
  if (!saved.ok) return saved;

  const data = parsed.data;
  const currency = data.currency?.toUpperCase() || "AUD";
  const heroImageUrl = data.heroImageUrl ? (/^https?:\/\//i.test(data.heroImageUrl) ? data.heroImageUrl : `https://${data.heroImageUrl}`) : null;
  const listing = await prisma.operatorListing.create({
    data: {
      operatorProfileId: input.operatorProfileId,
      slug: await uniqueListingSlug(data.title),
      title: data.title,
      category: data.category,
      region: data.region,
      description: data.description,
      heroImageUrl,
      priceFrom: data.priceFrom ?? null,
      priceSignal: data.priceFrom ? `From ${currency} ${data.priceFrom}` : null,
      currency,
      durationMinutes: input.durationMinutes && input.durationMinutes > 0 ? Math.round(input.durationMinutes) : null,
      meetingPoint: input.meetingPoint?.trim() || null,
      status: "LIVE",
      publishedAt: new Date(),
      ...linkData(checked.link, affiliate),
    },
  });
  return { ok: true, message: `"${listing.title}" is live, booking through your FareHarbor checkout.`, listingId: listing.id };
}

/** The stored link of a FareHarbor trip. */
export function fareHarborLinkOf(listing: { channelData: unknown; externalBookingUrl: string | null }): FareHarborLink | null {
  const stored = (listing.channelData as { link?: FareHarborLink } | null)?.link;
  if (stored?.shortname) return stored;
  return listing.externalBookingUrl ? parseFareHarborLink(listing.externalBookingUrl) : null;
}

/**
 * One traveller handed to the operator's FareHarbor checkout. The reference rides along
 * as FareHarbor's affiliate voucher number, so each booking in the affiliate report
 * matches back to the trip and to whoever referred the traveller.
 */
export async function recordHandoff(listing: { id: string; operatorProfileId: string; channelData: unknown; externalBookingUrl: string | null }, referralCode: string | null) {
  const affiliate = fareHarborAffiliate();
  const link = fareHarborLinkOf(listing);
  if (!affiliate || !link) return null;
  let reference = newBookingReference();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const taken = await prisma.channelHandoff.findUnique({ where: { reference }, select: { id: true } });
    if (!taken) break;
    reference = newBookingReference();
  }
  await prisma.channelHandoff.create({
    data: { reference, listingId: listing.id, operatorProfileId: listing.operatorProfileId, channel: "FAREHARBOR", referralCode: referralCode?.slice(0, 64) || null },
  });
  return {
    reference,
    url: fareHarborBookingUrl(link, { asn: affiliate, asnRef: reference }),
    lightframe: fareHarborLightframe(link, { asn: affiliate, asnRef: reference }),
  };
}
