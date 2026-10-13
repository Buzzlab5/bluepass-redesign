import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/services/auth/password";
import { approveOperatorClaim, createOperatorClaimForAccount } from "@/lib/services/operators/operator-claim-service";
import { resolveOperatorClaimToken } from "@/lib/services/operators/operator-claim-tokens";
import {
  approvePhotos,
  loadPreparedPage,
  photosOnPage,
  setPageCheck,
  setTripCheck,
} from "@/lib/services/operators/prepared-pages";

/**
 * Claiming a prepared page in one press.
 *
 * The claim link is emailed only to the address we hold for the business, used once, and
 * dead after a week, so opening it is the proof that the person is the business. They
 * see their whole page first, every photo included, and one press then does everything
 * the slower path did by hand: makes their account (or uses the one they have), approves
 * the claim, approves the photos they just looked at, and publishes the page. The
 * operator is the final word on their own facts; anything wrong they correct themselves
 * from their page afterwards.
 */

export type ClaimReview =
  | { ok: true; slug: string; name: string; email: string; page: NonNullable<Awaited<ReturnType<typeof loadPreparedPage>>> }
  | { ok: false; reason: "invalid" | "claimed" | "no_page"; message: string; slug?: string };

/** What the link opens: the page as it will be once claimed, with every photo. */
export async function reviewForClaim(token: string, now = new Date()): Promise<ClaimReview> {
  const resolved = await resolveOperatorClaimToken(token, now);
  if (!resolved.ok) return { ok: false, reason: "invalid", message: resolved.error };
  const lead = resolved.operatorLead;
  if (lead.status === "APPROVED" || lead.status === "LIVE") {
    return { ok: false, reason: "claimed", slug: lead.slug, message: `${lead.name} has already been claimed.` };
  }
  const page = await loadPreparedPage(lead.slug, { preview: true });
  if (!page) return { ok: false, reason: "no_page", slug: lead.slug, message: "There is no prepared page for this business yet." };
  return { ok: true, slug: lead.slug, name: lead.name, email: resolved.claimToken.email.trim().toLowerCase(), page };
}

/** Why a claim did not go through, for the review page to explain. */
export type ClaimFailure = "invalid" | "claimed" | "no_page" | "elsewhere";
export type ClaimResult = { ok: true; accountId: string; slug: string } | { ok: false; code: ClaimFailure; message: string };

export async function claimPreparedPage(input: { token: string; now?: Date }): Promise<ClaimResult> {
  const now = input.now ?? new Date();
  const review = await reviewForClaim(input.token, now);
  if (!review.ok) return { ok: false, code: review.reason, message: review.message };
  const resolved = await resolveOperatorClaimToken(input.token, now);
  if (!resolved.ok) return { ok: false, code: "invalid", message: resolved.error };
  const email = resolved.claimToken.email.trim().toLowerCase();

  // The link is spent before anything else happens, so a second press cannot claim twice.
  const spent = await prisma.operatorClaimToken.updateMany({ where: { id: resolved.claimToken.id, usedAt: null }, data: { usedAt: now } });
  if (spent.count === 0) return { ok: false, code: "invalid", message: "This claim link has already been used." };

  const existing = await prisma.bluePassAccount.findUnique({ where: { email }, include: { operatorProfile: { select: { claimedOperatorSlug: true } } } });
  const elsewhere = existing?.operatorProfile?.claimedOperatorSlug;
  if (elsewhere && elsewhere !== review.slug) {
    await prisma.operatorClaimToken.update({ where: { id: resolved.claimToken.id }, data: { usedAt: null } });
    return { ok: false, code: "elsewhere", message: `${email} already manages another page on Bluepass. Write to hello@bluepass.co and we will connect both.` };
  }
  const account = existing ?? await prisma.bluePassAccount.create({
    data: {
      email,
      // No password yet: they arrived by the emailed link, which also verifies the address.
      // They can set one from the sign-in page whenever they like.
      passwordHash: hashPassword(randomBytes(24).toString("base64url")),
      emailVerifiedAt: now,
      displayName: review.name,
      roles: ["TRAVELLER", "OPERATOR"],
    },
  });
  if (existing && !existing.emailVerifiedAt) {
    await prisma.bluePassAccount.update({ where: { id: existing.id }, data: { emailVerifiedAt: now } });
  }

  const claim = await createOperatorClaimForAccount({
    accountId: account.id,
    operatorSlug: review.slug,
    claimantName: review.name,
    claimantEmail: email,
    authorized: true,
    notes: `Claimed with the link emailed to ${email}.`,
  });
  await approveOperatorClaim({ claimId: claim.id, reviewerEmail: `claim link to ${email}` });

  // What they looked at is what goes live: every photo on the page, and every trip.
  const photos = photosOnPage(review.page).map((p) => p.url);
  await approvePhotos({ accountId: account.id, keep: photos });
  const reviewer = `operator ${email}`;
  for (const trip of review.page.trips) {
    if (trip.check.status !== "approved") await setTripCheck({ listingId: trip.id, status: "approved", notes: null, reviewer });
  }
  await setPageCheck({ slug: review.slug, status: "approved", notes: "Claimed and published by the operator.", reviewer });

  return { ok: true, accountId: account.id, slug: review.slug };
}
