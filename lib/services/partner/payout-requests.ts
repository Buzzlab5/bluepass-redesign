import { prisma } from "@/lib/db/prisma";
import { loadPartnerCommissionSummary, type AuLedgerLoader } from "@/lib/services/partner/dashboard";
import { listKaiCorePmsBookingLedgerForReferralPartner } from "@/lib/services/kai-core/client";
import { creatorCampaignEarnings } from "@/lib/services/onboarding/creator-campaigns";

/**
 * A partner minting a real request has no obvious "right" amount to require - $50 is generous
 * enough that a single referred booking usually crosses it, without letting someone cash out a few
 * dollars at a time. Applied per currency bucket as literal cents, with no FX conversion - a known
 * simplification (a $50-equivalent threshold in AUD isn't exactly $50 USD), not a hidden one.
 */
const MIN_PAYOUT_REQUEST_CENTS = 5000;

export type PartnerPayoutBalance = {
  currency: string;
  /** Total ever accrued (PARTNER_COMMISSION_ESTIMATE lines only), before subtracting requests. */
  accruedCents: number;
  /** What's left to request: accrued minus this partner's own PENDING/PAID requests so far. */
  availableCents: number;
  canRequest: boolean;
  /** Set when a request for this currency is already awaiting a decision. */
  pendingRequestedAt: Date | null;
};

/**
 * What this partner can request payout for, per currency.
 *
 * Deliberately not read off CommissionLedgerEntry.status - that table has no durable "paid" state
 * of its own (rows are deleted+recreated per booking inquiry on every resync, see
 * commission-ledger.ts's syncReferralCommissionLedger), so PartnerPayoutRequest is a separate,
 * append-only ledger layered on top: available = current accrued total minus everything already
 * requested (whether still pending or already paid), never a status flag on individual ledger rows.
 */
export async function getRequestablePartnerBalance(
  referralPartnerId: string,
  listAuLedger: AuLedgerLoader = listKaiCorePmsBookingLedgerForReferralPartner,
): Promise<PartnerPayoutBalance[]> {
  const [summary, requests, features] = await Promise.all([
    loadPartnerCommissionSummary(referralPartnerId, listAuLedger),
    prisma.partnerPayoutRequest.findMany({
      where: { referralPartnerId, status: { in: ["PENDING", "PAID"] } },
      select: { currency: true, amountCents: true, status: true, createdAt: true },
    }),
    // A creator also earns the credit an operator set aside for them, once they have featured
    // the operator and the operator's review window has passed (onboarding/creator-campaigns.ts).
    creatorCampaignEarnings(referralPartnerId),
  ]);

  const accrued = { ...summary.totalCentsByCurrency };
  for (const [currency, cents] of Object.entries(features)) accrued[currency] = (accrued[currency] ?? 0) + cents;

  return Object.entries(accrued).map(([currency, accruedCents]) => {
    const requestedCents = requests
      .filter((request) => request.currency === currency)
      .reduce((sum, request) => sum + request.amountCents, 0);
    const availableCents = Math.max(0, accruedCents - requestedCents);
    const pending = requests.find((request) => request.currency === currency && request.status === "PENDING");

    return {
      currency,
      accruedCents,
      availableCents,
      canRequest: !pending && availableCents >= MIN_PAYOUT_REQUEST_CENTS,
      pendingRequestedAt: pending?.createdAt ?? null,
    };
  });
}

export type CreatePartnerPayoutRequestResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Requests the entire available balance for one currency - not a partial/custom amount. Simpler
 * and avoids a whole class of edge cases (a request for more than is actually available, a request
 * that overlaps a differently-sized one); a partner who wants to leave some accrued and cash out
 * the rest can just wait and request again later.
 *
 * Recomputes the balance itself rather than trusting a client-supplied amount - the only inputs
 * that matter from the caller are which partner and which currency.
 */
export async function createPartnerPayoutRequest(
  referralPartnerId: string,
  input: { currency: string; requestedByAccountId: string },
  listAuLedger: AuLedgerLoader = listKaiCorePmsBookingLedgerForReferralPartner,
): Promise<CreatePartnerPayoutRequestResult> {
  const balances = await getRequestablePartnerBalance(referralPartnerId, listAuLedger);
  const balance = balances.find((entry) => entry.currency === input.currency);

  if (!balance) {
    return { ok: false, error: "There's no commission on file for that currency." };
  }

  if (balance.pendingRequestedAt) {
    return { ok: false, error: "You already have a payout request pending for this currency." };
  }

  if (balance.availableCents < MIN_PAYOUT_REQUEST_CENTS) {
    return {
      ok: false,
      error: `You need at least ${formatThreshold(input.currency)} available to request a payout.`,
    };
  }

  await prisma.partnerPayoutRequest.create({
    data: {
      referralPartnerId,
      requestedByAccountId: input.requestedByAccountId,
      amountCents: balance.availableCents,
      currency: input.currency,
    },
  });

  return { ok: true };
}

function formatThreshold(currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(MIN_PAYOUT_REQUEST_CENTS / 100);
  } catch {
    return `${(MIN_PAYOUT_REQUEST_CENTS / 100).toFixed(2)} ${currency}`;
  }
}
