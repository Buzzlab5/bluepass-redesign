import "@/lib/validation/zod-messages";
import { OperatorPayoutMethod } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { encryptCredentials } from "@/lib/services/booking/adapters/credentials";
import type { CancellationPolicyTier } from "@/lib/services/operators/operator-payout-account";

/**
 * The operator's own edits to the two things they should never have to email their Bluepass contact
 * about: where their money goes, and what they refund when a traveller cancels.
 *
 * Same data shape and the same encryption convention as `createManualOperator` — this is that
 * record being maintained, not a second one. The differences are all consequences of it being an
 * edit rather than a create, and each is called out where it happens.
 */

/** Selectable by an operator. STRIPE_CONNECT is deliberately not here — see `payoutMethodChoices`. */
export const OPERATOR_SELECTABLE_PAYOUT_METHODS = [
  OperatorPayoutMethod.MANUAL_BANK_TRANSFER,
  OperatorPayoutMethod.AIRWALLEX,
] as const;

/**
 * Mirrors `DEFAULT_CANCELLATION_POLICY_TIERS` in Kai's `src/core/cancellation/rules.ts`.
 *
 * Copied rather than imported because it lives in a separate deployment with no shared package
 * between them. It is duplicated here for one reason: an operator who has never set a policy is
 * already refunding on these terms, and showing them an empty form would hide that. They are
 * overriding something, not filling in a blank.
 *
 * If Kai's default changes, this copy goes stale and the operator is shown terms that are no longer
 * the ones being applied. That is a real risk of the duplication and the reason this constant is
 * labelled in the UI as the platform default rather than presented as their own policy.
 */
export const PLATFORM_DEFAULT_CANCELLATION_TIERS: CancellationPolicyTier[] = [
  { minDaysBeforeDeparture: 14, refundPercent: 100 },
  { minDaysBeforeDeparture: 3, refundPercent: 50 },
  { minDaysBeforeDeparture: 0, refundPercent: 0 },
];

export type PayoutSettingsResult =
  | { ok: true; payoutMethod: OperatorPayoutMethod }
  | { ok: false; message: string; field?: string };

export type CancellationPolicyResult =
  | { ok: true; tiers: CancellationPolicyTier[] }
  | { ok: false; message: string; field?: string };

/**
 * Whether this profile already has payout details stored.
 *
 * A separate query on purpose. `encryptedPayoutDetails` is write-only by design and is kept out of
 * `OperatorProfileView` so it can never be rendered by accident; the page still needs to know
 * whether anything is on file, so it gets the boolean and never the ciphertext.
 */
export async function hasStoredPayoutDetails(operatorProfileId: string) {
  const profile = await prisma.operatorProfile.findUnique({
    where: { id: operatorProfileId },
    select: { encryptedPayoutDetails: true },
  });

  return Boolean(profile?.encryptedPayoutDetails);
}

const payoutDetailsSchema = z.object({
  payoutMethod: z.enum(OPERATOR_SELECTABLE_PAYOUT_METHODS),
  bankDetails: z.string().trim().max(2000).optional(),
  airwallexReference: z.string().trim().max(200).optional(),
});

export type PayoutDetailsInput = z.input<typeof payoutDetailsSchema> & {
  operatorProfileId: string;
  /** The signed-in operator's own email, recorded on the profile as the audit trail. */
  updatedByEmail: string;
};

/**
 * Updates where this operator gets paid.
 *
 * Three rules that only exist because this is an edit:
 *
 * 1. Blank details mean "leave what you have", not "erase it". The stored value is never shown back
 *    (it is write-only ciphertext), so an operator changing only their payout *method* has no way
 *    to retype details they cannot see — treating an empty textarea as an instruction to wipe would
 *    silently delete the only copy of a real bank account.
 * 2. A method must end up with somewhere to send money. If nothing is on file and nothing is
 *    supplied, this rejects rather than saving a rail that pays into nothing.
 * 3. `notes` is appended to, never replaced — it already carries the onboarding audit line written
 *    by `createManualOperator`, and overwriting it would erase who first vouched for this operator.
 */
export async function updateOperatorPayoutDetails(
  input: PayoutDetailsInput,
): Promise<PayoutSettingsResult> {
  const parsed = payoutDetailsSchema.safeParse(input);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      message: issue?.message ?? "Please check these details and try again.",
      field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
    };
  }

  const data = parsed.data;
  const existing = await prisma.operatorProfile.findUnique({
    where: { id: input.operatorProfileId },
    select: { notes: true, encryptedPayoutDetails: true },
  });

  if (!existing) {
    return { ok: false, message: "That operator profile no longer exists." };
  }

  const recordedAt = new Date();
  const supplied =
    data.payoutMethod === OperatorPayoutMethod.MANUAL_BANK_TRANSFER
      ? data.bankDetails
      : data.airwallexReference;
  const field =
    data.payoutMethod === OperatorPayoutMethod.MANUAL_BANK_TRANSFER
      ? "bankDetails"
      : "airwallexReference";

  if (!supplied && !existing.encryptedPayoutDetails) {
    return {
      ok: false,
      message:
        data.payoutMethod === OperatorPayoutMethod.MANUAL_BANK_TRANSFER
          ? "Add your bank details — there is nothing on file for this profile yet, so a manual transfer would have nowhere to go."
          : "Add your Airwallex reference — there is nothing on file for this profile yet.",
      field,
    };
  }

  await prisma.operatorProfile.update({
    where: { id: input.operatorProfileId },
    data: {
      payoutMethod: data.payoutMethod,
      /* Rule 1: only written when the operator actually typed something. */
      ...(supplied
        ? {
            encryptedPayoutDetails: encryptCredentials({
              method: data.payoutMethod,
              ...(data.payoutMethod === OperatorPayoutMethod.MANUAL_BANK_TRANSFER
                ? { bankDetails: supplied }
                : { airwallexReference: supplied }),
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

  return { ok: true, payoutMethod: data.payoutMethod };
}

const tierSchema = z.object({
  minDaysBeforeDeparture: z
    .number({ message: "Days before departure must be a whole number." })
    .int("Days before departure must be a whole number.")
    .min(0, "Days before departure cannot be negative.")
    .max(3650, "Days before departure is unrealistically large."),
  refundPercent: z
    .number({ message: "Refund percent must be a number." })
    .int("Refund percent must be a whole number.")
    .min(0, "Refund percent cannot be below 0.")
    .max(100, "Refund percent cannot be above 100."),
});

/**
 * Validates a submitted policy against what Kai will actually do with it.
 *
 * The ordering and duplicate rules are about the operator reading their own policy back: a tier
 * list that jumps around is one a person misreads, and two rows for the same threshold means one of
 * them is dead.
 *
 * The floor rule is different, and is the one that matters most. Kai's `normalizePolicy` discards
 * an operator policy *in its entirety* — silently, falling back to the platform default — unless
 * some tier has `minDaysBeforeDeparture <= 0`. Accepting a floorless policy here would let an
 * operator save terms, see them rendered back as saved, and still have every real refund calculated
 * on Bluepass's default. So it is rejected at the point of entry, where it can still be explained,
 * instead of becoming a discrepancy nobody can see.
 */
export function parseCancellationTiers(raw: unknown): CancellationPolicyResult {
  const list = z.array(tierSchema).safeParse(raw);

  if (!list.success) {
    const issue = list.error.issues[0];
    return {
      ok: false,
      message: issue?.message ?? "Those cancellation tiers are not valid.",
      field: typeof issue?.path[0] === "number" ? `tier-${issue.path[0]}` : undefined,
    };
  }

  const tiers = list.data;

  if (tiers.length === 0) {
    return {
      ok: false,
      message: "Add at least one tier, ending with a 0-day row for cancellations on the day.",
    };
  }

  for (let i = 1; i < tiers.length; i += 1) {
    const previous = tiers[i - 1].minDaysBeforeDeparture;
    const current = tiers[i].minDaysBeforeDeparture;

    if (current === previous) {
      return {
        ok: false,
        message: `Two tiers both start at ${current} days before departure. Each threshold can only appear once.`,
        field: `tier-${i}`,
      };
    }

    if (current > previous) {
      return {
        ok: false,
        message:
          "Tiers must run from the most notice to the least — put the largest number of days first.",
        field: `tier-${i}`,
      };
    }
  }

  if (!tiers.some((tier) => tier.minDaysBeforeDeparture === 0)) {
    return {
      ok: false,
      message:
        "The last tier must start at 0 days, covering a cancellation on the day of departure. Without it Bluepass falls back to the platform default policy and ignores everything above.",
      field: `tier-${tiers.length - 1}`,
    };
  }

  return { ok: true, tiers };
}

/** Validates, then stores the policy as the JSON array Kai reads directly. */
export async function updateOperatorCancellationPolicy(input: {
  operatorProfileId: string;
  updatedByEmail: string;
  tiers: unknown;
}): Promise<CancellationPolicyResult> {
  const parsed = parseCancellationTiers(input.tiers);

  if (!parsed.ok) {
    return parsed;
  }

  const existing = await prisma.operatorProfile.findUnique({
    where: { id: input.operatorProfileId },
    select: { notes: true },
  });

  if (!existing) {
    return { ok: false, message: "That operator profile no longer exists." };
  }

  await prisma.operatorProfile.update({
    where: { id: input.operatorProfileId },
    data: {
      cancellationPolicyTiers: parsed.tiers,
      notes: appendNote(
        existing.notes,
        `Cancellation policy updated by ${input.updatedByEmail} on ${new Date().toISOString().slice(0, 10)}.`,
      ),
    },
  });

  return parsed;
}

/** Appends one audit line, preserving whatever is already there. */
function appendNote(existing: string | null, line: string) {
  return existing?.trim() ? `${existing.trim()}\n${line}` : line;
}
