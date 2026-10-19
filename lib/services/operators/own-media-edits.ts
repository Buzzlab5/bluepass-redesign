import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { OWN_LIMITS, ownUrls, withoutOwn, type OwnMedia } from "@/lib/services/operators/own-media";
import { claimedPreparedPage, loadPreparedPage } from "@/lib/services/operators/prepared-pages";
import { playable } from "@/lib/services/operators/videos";

/**
 * The operator adding to and taking from their own page: their logo, photos for the page
 * or a trip, and videos. Allowed only on the page their approved claim is for; the page is
 * always found from the signed-in account, never from what the browser sends.
 */

type Result = { ok: true; message: string } | { ok: false; message: string };

/** The operator's page and what they have added so far, or why they cannot add to it. */
export async function ownPageFor(accountId: string) {
  const claimed = await claimedPreparedPage(accountId);
  if (!claimed) return { ok: false as const, message: "There is no Bluepass page on your account." };
  if (!claimed.claimApproved) return { ok: false as const, message: "You can add photos once your claim is approved." };
  const row = await prisma.preparedOperatorPage.findUnique({ where: { slug: claimed.slug }, select: { operatorMedia: true } });
  return { ok: true as const, slug: claimed.slug, own: (row?.operatorMedia as OwnMedia | null) ?? {} };
}

async function save(slug: string, own: OwnMedia) {
  await prisma.preparedOperatorPage.update({
    where: { slug },
    data: { operatorMedia: own as unknown as Prisma.InputJsonValue, operatorMediaAt: new Date() },
  });
}

/** A stored upload added to the page's photos, or to one trip's. */
export async function addOwnPhoto(input: { accountId: string; url: string; target: string }): Promise<Result> {
  const page = await ownPageFor(input.accountId);
  if (!page.ok) return page;
  const own = page.own;
  if (input.target === "page") {
    if ((own.gallery ?? []).length >= OWN_LIMITS.gallery) return { ok: false, message: `Your page holds up to ${OWN_LIMITS.gallery} of your own photos. Remove one to add another.` };
    await save(page.slug, { ...own, gallery: [...(own.gallery ?? []), input.url] });
    return { ok: true, message: "Added to your page." };
  }
  const loaded = await loadPreparedPage(page.slug, { preview: true });
  const trip = loaded?.trips.find((t) => t.id === input.target);
  if (!trip) return { ok: false, message: "That trip is not on your page." };
  const list = own.trips?.[trip.id] ?? [];
  if (list.length >= OWN_LIMITS.trip) return { ok: false, message: `A trip holds up to ${OWN_LIMITS.trip} of your own photos. Remove one to add another.` };
  await save(page.slug, { ...own, trips: { ...(own.trips ?? {}), [trip.id]: [...list, input.url] } });
  return { ok: true, message: `Added to ${trip.trip.title}.` };
}

/** A stored logo in place of the one found on the website. */
export async function setOwnLogo(input: { accountId: string; url: string; light: boolean }): Promise<Result> {
  const page = await ownPageFor(input.accountId);
  if (!page.ok) return page;
  await save(page.slug, { ...page.own, logo: { url: input.url, light: input.light } });
  return { ok: true, message: "Your logo is on your page." };
}

/** One of the operator's photos chosen for the top of the page. */
export async function setOwnHero(input: { accountId: string; url: string }): Promise<Result> {
  const page = await ownPageFor(input.accountId);
  if (!page.ok) return page;
  const photos = ownUrls({ ...page.own, logo: null });
  if (!photos.has(input.url)) return { ok: false, message: "Choose one of the photos you added." };
  await save(page.slug, { ...page.own, hero: input.url });
  return { ok: true, message: "That photo now leads your page." };
}

/** A YouTube or Vimeo link, or a video file on the operator's own site. */
export async function addOwnVideo(input: { accountId: string; url: string; title: string }): Promise<Result> {
  const page = await ownPageFor(input.accountId);
  if (!page.ok) return page;
  const video = playable({ url: input.url.trim() });
  if (!video) return { ok: false, message: "Paste a YouTube or Vimeo link, or a link to an .mp4 file on your own website." };
  const videos = page.own.videos ?? [];
  if (videos.some((v) => playable(v)?.embed === video.embed)) return { ok: false, message: "That video is already on your page." };
  if (videos.length >= OWN_LIMITS.videos) return { ok: false, message: `Your page holds up to ${OWN_LIMITS.videos} of your own videos. Remove one to add another.` };
  await save(page.slug, { ...page.own, videos: [...videos, { url: input.url.trim(), title: input.title.trim() || null }] });
  return { ok: true, message: "Added to your page." };
}

/** Takes one of the operator's own photos, their logo or a video off the page. */
export async function removeOwn(input: { accountId: string; url: string }): Promise<Result> {
  const page = await ownPageFor(input.accountId);
  if (!page.ok) return page;
  const known = ownUrls(page.own).has(input.url) || (page.own.videos ?? []).some((v) => v.url === input.url);
  if (!known) return { ok: false, message: "That is not one you added." };
  await save(page.slug, withoutOwn(page.own, input.url));
  return { ok: true, message: "Removed from your page." };
}
