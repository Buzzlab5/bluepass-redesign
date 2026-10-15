import "@/lib/validation/zod-messages";
import { OperatorPayoutMethod } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { encryptCredentials } from "@/lib/services/booking/adapters/credentials";
import { PAYOUT_METHODS } from "./operator-onboarding";

/**
 * Viewing and editing an operator profile that already exists — the counterpart to
 * operator-onboarding.ts's createManualOperator, which only ever creates one. Two admin gaps this
 * closes: there was no way to browse existing operators at all, and no way to correct one after
 * creation short of the operator self-editing their own payout/cancellation settings (app/operator)
 * or a direct database change.
 */

export type OperatorListRow = {
  id: string;
  companyName: string | null;
  accountEmail: string;
  status: string;
  payoutMethod: OperatorPayoutMethod;
  country: string | null;
  rezdySupplierId: string | null;
  hasPayoutDetails: boolean;
  createdAt: Date;
};

export async function listOperatorProfiles(): Promise<OperatorListRow[]> {
  const rows = await prisma.operatorProfile.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      companyName: true,
      status: true,
      payoutMethod: true,
      country: true,
      rezdySupplierId: true,
      encryptedPayoutDetails: true,
      stripeConnectAccountId: true,
      createdAt: true,
      account: { select: { email: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    companyName: row.companyName,
    accountEmail: row.account.email,
    status: row.status,
    payoutMethod: row.payoutMethod,
    country: row.country,
    rezdySupplierId: row.rezdySupplierId,
    hasPayoutDetails: Boolean(row.encryptedPayoutDetails || row.stripeConnectAccountId),
    createdAt: row.createdAt,
  }));
}

export type OperatorEditView = {
  id: string;
  companyName: string | null;
  accountEmail: string;
  status: string;
  whatsappE164: string | null;
  websiteUrl: string | null;
  country: string | null;
  payoutMethod: OperatorPayoutMethod;
  hasPayoutDetails: boolean;
  stripeConnectAccountId: string | null;
  rezdySupplierId: string | null;
  notes: string | null;
  createdAt: Date;
};

export async function getOperatorForEdit(operatorProfileId: string): Promise<OperatorEditView | null> {
  const profile = await prisma.operatorProfile.findUnique({
    where: { id: operatorProfileId },
    select: {
      id: true,
      companyName: true,
      status: true,
      whatsappE164: true,
      websiteUrl: true,
      country: true,
      payoutMethod: true,
      encryptedPayoutDetails: true,
      stripeConnectAccountId: true,
      rezdySupplierId: true,
      notes: true,
      createdAt: true,
      account: { select: { email: true } },
    },
  });

  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    companyName: profile.companyName,
    accountEmail: profile.account.email,
    status: profile.status,
    whatsappE164: profile.whatsappE164,
    websiteUrl: profile.websiteUrl,
    country: profile.country,
    payoutMethod: profile.payoutMethod,
    hasPayoutDetails: Boolean(profile.encryptedPayoutDetails),
    stripeConnectAccountId: profile.stripeConnectAccountId,
    rezdySupplierId: profile.rezdySupplierId,
    notes: profile.notes,
    createdAt: profile.createdAt,
  };
}

export type OperatorEditResult = { ok: true } | { ok: false; message: string; field?: string };

const basicInfoSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required.").max(200),
  whatsappE164: optionalText(40),
  websiteUrl: optionalText(300),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use a two-letter country code, e.g. AU or ID.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  rezdySupplierId: optionalText(120),
});

export type BasicInfoInput = z.input<typeof basicInfoSchema> & {
  operatorProfileId: string;
  updatedByEmail: string;
};

/**
 * Updates the business-identity fields. Unlike the payout details below, every field here is shown
 * back to the admin pre-filled with its current value, so — unlike the write-only payout convention
 * — a blank submission genuinely means "clear this", not "leave it". Deliberately does not include
 * `payoutContactEmail`: that field doubles as the linked BluePassAccount's login email, and renaming
 * it here without also touching the account is a different, riskier piece of work than this page
 * covers.
 */
export async function updateOperatorBasicInfo(input: BasicInfoInput): Promise<OperatorEditResult> {
  const parsed = basicInfoSchema.safeParse(input);

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
    select: { notes: true },
  });

  if (!existing) {
    return { ok: false, message: "That operator profile no longer exists." };
  }

  if (data.rezdySupplierId) {
    const clash = await prisma.operatorProfile.findUnique({
      where: { rezdySupplierId: data.rezdySupplierId },
      select: { id: true, companyName: true },
    });

    if (clash && clash.id !== input.operatorProfileId) {
      return {
        ok: false,
        message: `Rezdy supplier ID ${data.rezdySupplierId} is already on the profile for ${clash.companyName ?? "another operator"}. A supplier ID can only belong to one operator.`,
        field: "rezdySupplierId",
      };
    }
  }

  await prisma.operatorProfile.update({
    where: { id: input.operatorProfileId },
    data: {
      companyName: data.companyName,
      whatsappE164: data.whatsappE164 ?? null,
      websiteUrl: normalizeUrl(data.websiteUrl),
      country: data.country ?? null,
      rezdySupplierId: data.rezdySupplierId ?? null,
      notes: appendNote(
        existing.notes,
        `Basic info updated by ${input.updatedByEmail} on ${new Date().toISOString().slice(0, 10)}.`,
      ),
    },
  });

  return { ok: true };
}

const adminPayoutSchema = z.object({
  payoutMethod: z.enum(PAYOUT_METHODS),
  bankDetails: optionalText(2000),
  airwallexReference: optionalText(200),
  stripeConnectAccountId: optionalText(120),
});

export type AdminPayoutInput = z.input<typeof adminPayoutSchema> & {
  operatorProfileId: string;
  updatedByEmail: string;
};

/**
 * The admin-side payout editor. Unlike the operator's own self-service version
 * (lib/services/operator/payout-settings.ts), this one allows all three payout methods including
 * STRIPE_CONNECT — an operator can't select that for themselves (the account is created by Kai via
 * the admin bridge), but an admin recording an ID Kai has already produced is exactly what
 * `stripeConnectAccountId` on the schema is for.
 *
 * Same write-only rule as everywhere else this data lives: bank details / Airwallex reference are
 * never read back into the form, so a blank submission means "leave what's on file", never "erase
 * it" — the admin has no way to tell those two apart from what's on screen, since the current value
 * is never rendered.
 */
export async function updateOperatorPayoutForAdmin(input: AdminPayoutInput): Promise<OperatorEditResult> {
  const parsed = adminPayoutSchema.safeParse(input);

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
    select: { notes: true },
  });

  if (!existing) {
    return { ok: false, message: "That operator profile no longer exists." };
  }

  if (data.stripeConnectAccountId) {
    const clash = await prisma.operatorProfile.findUnique({
      where: { stripeConnectAccountId: data.stripeConnectAccountId },
      select: { id: true },
    });

    if (clash && clash.id !== input.operatorProfileId) {
      return {
        ok: false,
        message: `Stripe Connect account ${data.stripeConnectAccountId} is already recorded on another operator profile.`,
        field: "stripeConnectAccountId",
      };
    }
  }

  const recordedAt = new Date().toISOString();

  await prisma.operatorProfile.update({
    where: { id: input.operatorProfileId },
    data: {
      payoutMethod: data.payoutMethod,
      stripeConnectAccountId: data.stripeConnectAccountId ?? null,
      ...(data.payoutMethod === OperatorPayoutMethod.MANUAL_BANK_TRANSFER && data.bankDetails
        ? {
            encryptedPayoutDetails: encryptCredentials({
              method: OperatorPayoutMethod.MANUAL_BANK_TRANSFER,
              bankDetails: data.bankDetails,
              recordedBy: input.updatedByEmail,
              recordedAt,
            }),
          }
        : {}),
      ...(data.payoutMethod === OperatorPayoutMethod.AIRWALLEX && data.airwallexReference
        ? {
            encryptedPayoutDetails: encryptCredentials({
              method: OperatorPayoutMethod.AIRWALLEX,
              airwallexReference: data.airwallexReference,
              recordedBy: input.updatedByEmail,
              recordedAt,
            }),
          }
        : {}),
      notes: appendNote(
        existing.notes,
        `Payout details updated by ${input.updatedByEmail} on ${recordedAt.slice(0, 10)} (admin console).`,
      ),
    },
  });

  return { ok: true };
}

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));
}

/** Matches operator-onboarding.ts / operator-claim-service.ts: a bare domain is stored as https://. */
function normalizeUrl(value?: string) {
  if (!value) {
    return null;
  }

  return /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, "")}`;
}

function appendNote(existing: string | null, line: string) {
  return existing?.trim() ? `${existing.trim()}\n${line}` : line;
}
