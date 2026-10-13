import { prisma } from "@/lib/db/prisma";
import {
  listAcrossStatuses,
  section,
  toIndonesiaLedgerRow,
  type LedgerRowView,
  type SectionResult,
} from "@/lib/services/admin/payouts";
import {
  fetchRezdyAgentManualInquiries,
  type RezdyAgentManualInquiry,
} from "@/lib/services/discover/rezdy-agent-sync";
import {
  listKaiCoreBluePassLedger,
  type KaiCoreBluePassLedgerEntry,
} from "@/lib/services/kai-core/client";
import type { OperatorProfileView } from "@/lib/services/operator/guard";

/**
 * Which booking source, if any, this operator's history can actually be read from.
 *
 * Kept as its own pure function because the branch is the load-bearing part of the dashboard and
 * each arm is a different promise to the operator:
 *
 * - `kai-tenant`  — the operator has a Kai Tenant of their own (`kaiTenantSlug`), so their ledger is
 *                   one tenant-scoped call. Most live `OperatorProfile` rows are this kind.
 * - `rezdy-agent` — a Rezdy-Agent operator discovered by the Discover sync. Kai's AU ledger
 *                   endpoints are tenant-scoped and this operator has no tenant of its own, so
 *                   there is no per-operator lookup to make. Their bookings exist; we cannot read
 *                   them from here yet.
 * - `unlinked`    — manually onboarded, not yet attached to any live booking source.
 *
 * The last two are not empty states and must never render as an empty table. "No rows" and "we
 * cannot see your rows" are different sentences, and only one of them is true here.
 */
export type OperatorBookingSource =
  | { kind: "kai-tenant"; tenantSlug: string }
  | { kind: "rezdy-agent"; rezdySupplierId: string }
  | { kind: "unlinked" };

/**
 * `kaiTenantSlug` wins when both are set. A profile carrying both is an operator whose Rezdy
 * products were matched into a profile that also has its own Kai tenant, and the tenant is the one
 * with a ledger behind it — preferring the source we can actually read is what keeps that operator
 * off the "not available yet" message.
 */
export function operatorBookingSource(profile: {
  kaiTenantSlug: string | null;
  rezdySupplierId: string | null;
}): OperatorBookingSource {
  if (profile.kaiTenantSlug) {
    return { kind: "kai-tenant", tenantSlug: profile.kaiTenantSlug };
  }

  if (profile.rezdySupplierId) {
    return { kind: "rezdy-agent", rezdySupplierId: profile.rezdySupplierId };
  }

  return { kind: "unlinked" };
}

/**
 * The source, plus the rows when there are rows to have. Flattened onto the same `kind` the source
 * carries rather than nested under it, so one `switch` in the component covers both "which of the
 * situations is this" and "did the fetch work".
 *
 * `rezdy-agent` carries a result too, unlike before - see the module comment on
 * `loadRezdyAgentInquiries` for why this became a real, fetchable source instead of a permanent
 * "cannot be read from here" dead end.
 */
export type OperatorBookings =
  | (Extract<OperatorBookingSource, { kind: "kai-tenant" }> & {
      result: SectionResult<LedgerRowView[]>;
    })
  | (Extract<OperatorBookingSource, { kind: "rezdy-agent" }> & {
      result: SectionResult<RezdyAgentManualInquiry[]>;
    })
  | Extract<OperatorBookingSource, { kind: "unlinked" }>;

type LedgerLoader = typeof listKaiCoreBluePassLedger;
type ManualInquiryLoader = typeof fetchRezdyAgentManualInquiries;

/**
 * The operator's own ledger lines, newest first, across every status.
 *
 * Unfiltered on purpose, where the admin page defaults to PENDING: an admin is hunting for money
 * that has not moved, an operator is reading their own history and a page that silently hid every
 * finalised booking would look like their completed work had vanished.
 *
 * Rows are shaped by `toIndonesiaLedgerRow` rather than a second normaliser, then stripped of their
 * `action`. That field means "an admin may release this payout by hand", and the actions behind it
 * are admin-gated, so an operator rendering one could only ever produce a button that refuses. The
 * decision to pay is the admin console's; this page reports it.
 */
export async function loadOperatorBookings(
  profile: Pick<OperatorProfileView, "id" | "kaiTenantSlug" | "rezdySupplierId">,
  listLedger: LedgerLoader = listKaiCoreBluePassLedger,
  listManualInquiries: ManualInquiryLoader = fetchRezdyAgentManualInquiries,
): Promise<OperatorBookings> {
  const source = operatorBookingSource(profile);

  if (source.kind === "unlinked") {
    return source;
  }

  if (source.kind === "rezdy-agent") {
    return {
      ...source,
      result: await section(() => loadRezdyAgentInquiries(profile.id, listManualInquiries)),
    };
  }

  const { tenantSlug } = source;

  return {
    ...source,
    result: await section(async () => {
      const entries = await listAcrossStatuses<KaiCoreBluePassLedgerEntry>("ALL", (status) =>
        listLedger({ tenantSlug, status }),
      );

      return entries.map((entry) => ({ ...toIndonesiaLedgerRow(entry, tenantSlug), action: null }));
    }),
  };
}

/**
 * A Rezdy-Agent operator's "bookings" today are real ManualInquiry rows on Kai's canonical shared
 * tenant (bookingMode MANUAL_INQUIRY, confirmed against production 2026-08-25), not ledger entries -
 * see `OperatorListing.externalProductId`'s schema comment for the full picture. This is the query
 * that turns that shared pool back into "this operator's inquiries": every product id their own live
 * listings carry, sent to Kai, filtered there.
 *
 * A listing with no `externalProductId` yet (synced before this field existed, or manually re-synced
 * has not happened since) simply contributes nothing rather than erroring - the operator still sees
 * whatever their other listings' ids do turn up.
 */
async function loadRezdyAgentInquiries(
  operatorProfileId: string,
  listManualInquiries: ManualInquiryLoader,
): Promise<RezdyAgentManualInquiry[]> {
  const listings = await prisma.operatorListing.findMany({
    where: { operatorProfileId, externalProductId: { not: null } },
    select: { externalProductId: true },
  });

  const productIds = listings
    .map((listing) => listing.externalProductId)
    .filter((id): id is string => Boolean(id));

  return listManualInquiries(productIds);
}

export type OperatorListingRow = {
  id: string;
  title: string;
  status: string;
  region: string;
  category: string;
  priceSignal: string | null;
  publishedAt: Date | null;
  /* Everything below is only read by the self-service listing editor (non-Rezdy operators) to
     pre-fill an edit form for a DRAFT row - not shown anywhere on the read-only card. Cheap to
     include for every operator since none of it is sensitive, unlike payout details. */
  description: string;
  heroImageUrl: string | null;
  maxGuests: number | null;
  priceFrom: number | null;
  currency: string;
  /** Set when the listing is written from a trip on the Trips page, which is then the only place to change it. */
  nativeTripId: string | null;
};

/**
 * The operator's listings, read-only.
 *
 * Archived rows are included rather than filtered out: an operator whose listing was pulled needs
 * to see that it was, and an archived listing quietly missing from this list would read as a bug in
 * the page rather than as a decision someone made.
 */
export async function loadOperatorListings(operatorProfileId: string): Promise<OperatorListingRow[]> {
  return prisma.operatorListing.findMany({
    where: { operatorProfileId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      status: true,
      region: true,
      category: true,
      priceSignal: true,
      publishedAt: true,
      description: true,
      heroImageUrl: true,
      maxGuests: true,
      priceFrom: true,
      currency: true,
      nativeTripId: true,
    },
  });
}
