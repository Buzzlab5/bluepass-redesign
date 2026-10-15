import "@/lib/validation/zod-messages";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { encryptCredentials } from "@/lib/services/booking/adapters/credentials";

/**
 * The partner's own edit to where their money goes - the partner-side equivalent of
 * lib/services/operator/payout-settings.ts's updateOperatorPayoutDetails, trimmed to the one rail
 * partners actually have (manual bank transfer only; no Stripe Connect/Airwallex - those are
 * operator-specific infra tied to Kai's own account-creation flow).
 */

export type PayoutSettingsResult = { ok: true } | { ok: false; message: string; field?: string };

/**
 * Whether this profile already has payout details stored.
 *
 * A separate query on purpose - encryptedPayoutDetails is write-only by design and stays out of
 * PartnerProfileView so it can never be rendered by accident; the page still needs to know whether
 * anything is on file, so it gets the boolean and never the ciphertext.
 */
export async function hasStoredPartnerPayoutDetails(partnerProfileId: string) {
  const profile = await prisma.partnerProfile.findUnique({
    where: { id: partnerProfileId },
    select: { encryptedPayoutDetails: true },
  });

  return Boolean(profile?.encryptedPayoutDetails);
}

const payoutDetailsSchema = z.object({
  bankDetails: z.string().trim().max(2000).optional(),
});

export type PayoutDetailsInput = z.input<typeof payoutDetailsSchema> & {
  partnerProfileId: string;
  /** The signed-in partner's own email, recorded on the profile as the audit trail. */
  updatedByEmail: string;
};

/**
 * Updates where this partner gets paid.
 *
 * Same two rules as the operator version, for the same reasons: blank details mean "leave what you
 * have" (the stored value is write-only ciphertext, never shown back, so there's no way to retype
 * something you can't see), and a save with nothing supplied and nothing on file is rejected rather
 * than silently leaving payout details empty.
 */
export async function updatePartnerPayoutDetails(input: PayoutDetailsInput): Promise<PayoutSettingsResult> {
  const parsed = payoutDetailsSchema.safeParse(input);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? "Please check these details and try again." };
  }

  const existing = await prisma.partnerProfile.findUnique({
    where: { id: input.partnerProfileId },
    select: { notes: true, encryptedPayoutDetails: true },
  });

  if (!existing) {
    return { ok: false, message: "Your partner profile no longer exists." };
  }

  const supplied = parsed.data.bankDetails;

  if (!supplied && !existing.encryptedPayoutDetails) {
    return {
      ok: false,
      message: "Add your bank details — there is nothing on file yet, so a payout would have nowhere to go.",
      field: "bankDetails",
    };
  }

  const recordedAt = new Date();

  await prisma.partnerProfile.update({
    where: { id: input.partnerProfileId },
    data: {
      ...(supplied
        ? {
            encryptedPayoutDetails: encryptCredentials({
              method: "MANUAL_BANK_TRANSFER",
              bankDetails: supplied,
              recordedBy: input.updatedByEmail,
              recordedAt: recordedAt.toISOString(),
            }),
          }
        : {}),
      notes: appendNote(
        existing.notes,
        `Payout details updated by ${input.updatedByEmail} on ${recordedAt.toISOString().slice(0, 10)}.`,
      ),
    },
  });

  return { ok: true };
}

/** Appends one audit line, preserving whatever is already there. */
function appendNote(existing: string | null, line: string) {
  return existing?.trim() ? `${existing.trim()}\n${line}` : line;
}
