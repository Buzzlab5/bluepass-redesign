import "@/lib/validation/zod-messages";
import { randomBytes } from "node:crypto";
import { OperatorPayoutMethod } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { encryptCredentials } from "@/lib/services/booking/adapters/credentials";

export const PAYOUT_METHODS = [
  OperatorPayoutMethod.MANUAL_BANK_TRANSFER,
  OperatorPayoutMethod.STRIPE_CONNECT,
  OperatorPayoutMethod.AIRWALLEX,
] as const;

export const manualOperatorSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required.").max(200),
  payoutContactEmail: z
    .string()
    .trim()
    .min(1, "A payout contact email is required.")
    .email("That does not look like a valid email address.")
    .max(200)
    .transform((value) => value.toLowerCase()),
  whatsappE164: optionalText(40),
  websiteUrl: optionalText(300),
  /* ISO 3166-1 alpha-2, per the schema field's own comment — it drives payout
     routing, so a free-text "Australia" here would be worse than nothing. */
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use a two-letter country code, e.g. AU or ID.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  payoutMethod: z.enum(PAYOUT_METHODS),
  /** MANUAL_BANK_TRANSFER only — encrypted at rest, never stored as plain text. */
  bankDetails: optionalText(2000),
  /** STRIPE_CONNECT only — recorded, not created. See the note in `create`. */
  stripeConnectAccountId: optionalText(120),
  /** AIRWALLEX only — deliberately unvalidated, no live account exists yet. */
  airwallexReference: optionalText(200),
  rezdySupplierId: optionalText(120),
  /** Set once the admin has seen a same-name match and chosen to proceed anyway. */
  confirmDuplicate: z.boolean().optional(),
});

export type ManualOperatorInput = z.input<typeof manualOperatorSchema> & {
  /** The signed-in admin, recorded on the profile as the audit trail. */
  createdByEmail: string;
};

export type DuplicateMatch = {
  operatorProfileId: string;
  companyName: string | null;
  accountEmail: string;
  status: string;
  rezdySupplierId: string | null;
  /**
   * A `rezdySupplierId` collision is a hard stop — the column is unique, so a
   * second profile carrying it cannot exist. A `companyName` collision is a
   * warning the admin can override once they have checked it is genuinely a
   * different business.
   */
  matchedOn: "rezdySupplierId" | "companyName";
};

export type ManualOperatorResult =
  | {
      ok: true;
      operatorProfileId: string;
      accountId: string;
      companyName: string;
      payoutContactEmail: string;
    }
  | { ok: false; code: "VALIDATION"; message: string; field?: string }
  | { ok: false; code: "DUPLICATE_PROFILE"; message: string; duplicate: DuplicateMatch }
  | { ok: false; code: "EMAIL_TAKEN"; message: string; field: "payoutContactEmail" }
  | { ok: false; code: "STRIPE_ACCOUNT_TAKEN"; message: string; field: "stripeConnectAccountId" };

/**
 * Creates a real, LIVE operator from a deal a staff member closed by phone or
 * email.
 *
 * The account this creates is a placeholder in exactly the sense
 * `rezdy-agent-sync.ts` already establishes: a random, unusable `passwordHash`,
 * because operators have no login flow yet. It exists so the profile — and the
 * payout details on it — have somewhere to attach. Do not read it as "the
 * operator now has an account they can sign into"; they cannot, and bridging
 * that is a separate piece of work.
 *
 * `status` is LIVE rather than PENDING_REVIEW on purpose: an admin filling in
 * this form *is* the vetting step, and routing it into the approvals queue
 * would ask the same person to approve their own data entry.
 */
export async function createManualOperator(input: ManualOperatorInput): Promise<ManualOperatorResult> {
  const parsed = manualOperatorSchema.safeParse(input);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];

    return {
      ok: false,
      code: "VALIDATION",
      message: issue?.message ?? "Please check the details and try again.",
      field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
    };
  }

  const data = parsed.data;
  const websiteUrl = normalizeUrl(data.websiteUrl);

  const duplicate = await findDuplicateProfile({
    companyName: data.companyName,
    rezdySupplierId: data.rezdySupplierId,
  });

  /* A duplicate here is not cosmetic: two profiles for one real business means
     two payout destinations, and the wrong one can be paid. Never create the
     second one silently — either the admin uses the existing profile, or they
     tell us explicitly that this is a different business with a similar name. */
  if (duplicate && (duplicate.matchedOn === "rezdySupplierId" || !data.confirmDuplicate)) {
    return {
      ok: false,
      code: "DUPLICATE_PROFILE",
      message:
        duplicate.matchedOn === "rezdySupplierId"
          ? `Rezdy supplier ID ${data.rezdySupplierId} is already on the profile for ${duplicate.companyName ?? duplicate.accountEmail}. Update that profile instead — a supplier ID can only belong to one operator.`
          : `An operator profile for “${duplicate.companyName}” already exists (${duplicate.accountEmail}, ${duplicate.status}). Use that profile, or confirm below if this is a genuinely different business.`,
      duplicate,
    };
  }

  const existingAccount = await prisma.bluePassAccount.findUnique({
    where: { email: data.payoutContactEmail },
    select: { id: true },
  });

  if (existingAccount) {
    return {
      ok: false,
      code: "EMAIL_TAKEN",
      message: `${data.payoutContactEmail} already has a BluePass account. Use a different payout contact email, or attach the operator profile to the existing account.`,
      field: "payoutContactEmail",
    };
  }

  if (data.stripeConnectAccountId) {
    const existingStripe = await prisma.operatorProfile.findUnique({
      where: { stripeConnectAccountId: data.stripeConnectAccountId },
      select: { id: true },
    });

    if (existingStripe) {
      return {
        ok: false,
        code: "STRIPE_ACCOUNT_TAKEN",
        message: `Stripe Connect account ${data.stripeConnectAccountId} is already recorded on another operator profile.`,
        field: "stripeConnectAccountId",
      };
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const account = await tx.bluePassAccount.create({
      data: {
        email: data.payoutContactEmail,
        // Unusable by design — same convention as rezdy-agent-sync.ts.
        passwordHash: randomBytes(32).toString("hex"),
        displayName: data.companyName,
        roles: ["OPERATOR"],
      },
      select: { id: true },
    });

    const profile = await tx.operatorProfile.create({
      data: {
        accountId: account.id,
        status: "LIVE",
        companyName: data.companyName,
        payoutContactEmail: data.payoutContactEmail,
        whatsappE164: data.whatsappE164 ?? null,
        websiteUrl,
        country: data.country ?? null,
        payoutMethod: data.payoutMethod,
        encryptedPayoutDetails: buildEncryptedPayoutDetails(data, input.createdByEmail),
        /* Recorded only. Connect accounts are created by Kai through the admin
           bridge (see the schema comment on this column); this form never talks
           to Stripe's account API. */
        stripeConnectAccountId: data.stripeConnectAccountId ?? null,
        rezdySupplierId: data.rezdySupplierId ?? null,
        notes: `Manually onboarded by ${input.createdByEmail} on ${new Date().toISOString().slice(0, 10)}.`,
      },
      select: { id: true },
    });

    return { accountId: account.id, operatorProfileId: profile.id };
  });

  return {
    ok: true,
    operatorProfileId: created.operatorProfileId,
    accountId: created.accountId,
    companyName: data.companyName,
    payoutContactEmail: data.payoutContactEmail,
  };
}

/**
 * The duplicate guard. `rezdySupplierId` is checked first because it is an
 * exact identity match on a unique column; the company-name check is a
 * case-insensitive fallback for the far commoner case of the same business
 * being onboarded twice by two different staff members.
 */
export async function findDuplicateProfile(input: {
  companyName: string;
  rezdySupplierId?: string | null;
}): Promise<DuplicateMatch | null> {
  const rezdySupplierId = input.rezdySupplierId?.trim();
  const companyName = input.companyName.trim();

  if (rezdySupplierId) {
    const bySupplier = await prisma.operatorProfile.findUnique({
      where: { rezdySupplierId },
      select: duplicateSelect,
    });

    if (bySupplier) {
      return toDuplicateMatch(bySupplier, "rezdySupplierId");
    }
  }

  if (!companyName) {
    return null;
  }

  const byName = await prisma.operatorProfile.findFirst({
    where: { companyName: { equals: companyName, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: duplicateSelect,
  });

  return byName ? toDuplicateMatch(byName, "companyName") : null;
}

const duplicateSelect = {
  id: true,
  companyName: true,
  status: true,
  rezdySupplierId: true,
  account: { select: { email: true } },
} as const;

function toDuplicateMatch(
  profile: {
    id: string;
    companyName: string | null;
    status: string;
    rezdySupplierId: string | null;
    account: { email: string };
  },
  matchedOn: DuplicateMatch["matchedOn"],
): DuplicateMatch {
  return {
    operatorProfileId: profile.id,
    companyName: profile.companyName,
    accountEmail: profile.account.email,
    status: profile.status,
    rezdySupplierId: profile.rezdySupplierId,
    matchedOn,
  };
}

/**
 * Bank details and the Airwallex reference both land in
 * `encryptedPayoutDetails` via the same `encryptCredentials` helper
 * `OperatorIntegration.encryptedCredentials` uses — there is no separate
 * Airwallex column, and a payout reference belongs with the payout data rather
 * than in free-text notes. `stripeConnectAccountId` is not secret and has its
 * own column, so it is not duplicated in here.
 */
function buildEncryptedPayoutDetails(
  data: z.output<typeof manualOperatorSchema>,
  recordedBy: string,
) {
  const recordedAt = new Date().toISOString();

  if (data.payoutMethod === OperatorPayoutMethod.MANUAL_BANK_TRANSFER && data.bankDetails) {
    return encryptCredentials({
      method: OperatorPayoutMethod.MANUAL_BANK_TRANSFER,
      bankDetails: data.bankDetails,
      recordedBy,
      recordedAt,
    });
  }

  if (data.payoutMethod === OperatorPayoutMethod.AIRWALLEX && data.airwallexReference) {
    return encryptCredentials({
      method: OperatorPayoutMethod.AIRWALLEX,
      airwallexReference: data.airwallexReference,
      recordedBy,
      recordedAt,
    });
  }

  return null;
}

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));
}

/** Matches operator-claim-service.ts: a bare domain is stored as https://. */
function normalizeUrl(value?: string) {
  if (!value) {
    return null;
  }

  return /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, "")}`;
}
