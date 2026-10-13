import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import OperatorBookings from "@/components/operator/OperatorBookings";
import OperatorCancellationPolicy from "@/components/operator/OperatorCancellationPolicy";
import OperatorListings from "@/components/operator/OperatorListings";
import OperatorPayoutSettings from "@/components/operator/OperatorPayoutSettings";
import OperatorProfileSummary from "@/components/operator/OperatorProfileSummary";
import RailsToday from "@/components/rails/RailsToday";
import { loadOperatorBookings, loadOperatorListings } from "@/lib/services/operator/dashboard";
import { requireOperatorOrRedirect } from "@/lib/services/operator/guard";
import { claimedPreparedPage } from "@/lib/services/operators/prepared-pages";
import {
  hasStoredPayoutDetails,
  PLATFORM_DEFAULT_CANCELLATION_TIERS,
} from "@/lib/services/operator/payout-settings";
import type { CancellationPolicyTier } from "@/lib/services/operators/operator-payout-account";
import { railsAccess } from "@/lib/services/rails/access";
import { operatorRailsSummary } from "@/lib/services/rails/views";

export const metadata = { title: "Your operator dashboard · Bluepass" };

/**
 * What an operator sees when they sign in: who Bluepass thinks they are, what it is showing
 * travellers on their behalf, what it owes them, and — since this round — the two things they can
 * change themselves without going through their Bluepass contact.
 *
 * The gate runs again here rather than being inherited from the layout. It costs one query and it
 * is what makes this page safe to link to directly, independent of whatever the layout did.
 */
export default async function OperatorDashboardPage() {
  const { account, profile } = await requireOperatorOrRedirect("/operator");

  /* Independent loads. The listings come from this app's own database and the ledger from Kai
     across the network, so a Kai that is down must not take the rest of the page with it —
     `loadOperatorBookings` captures its own failure rather than throwing. */
  const [listings, bookings, hasDetailsOnFile, rails, prepared] = await Promise.all([
    loadOperatorListings(profile.id),
    loadOperatorBookings(profile),
    hasStoredPayoutDetails(profile.id),
    railsAccess(profile),
    claimedPreparedPage(account.id),
  ]);
  const railsSummary = rails.enabled ? await operatorRailsSummary(profile.id) : null;

  /* Stored as `Json?`, so Prisma types it as JsonValue and it has to be narrowed before use. A row
     written by anything other than this form could be any shape at all; treating a non-array as
     "no policy set" lands the operator on the platform default, which is what Kai would do with it
     anyway. */
  const saved = profile.cancellationPolicyTiers;
  const savedTiers: CancellationPolicyTier[] = Array.isArray(saved)
    ? (saved as unknown as CancellationPolicyTier[])
    : [];

  return (
    <>
      <AdminPageHeader
        eyebrow="Your account"
        title={profile.companyName ?? "Your operator dashboard"}
        support="Everything Bluepass holds for you in one place — your profile and payout setup, your listing, and the bookings and payouts behind them."
      />

      {prepared?.claimApproved && prepared.undecided > 0 ? (
        <Link href="/operator/your-page" className="adm-card op-prompt">
          <span className="ds-body">{prepared.approvedAt ? `${prepared.undecided} new ${prepared.undecided === 1 ? "photo" : "photos"} on your page` : "Choose the photos on your page"}</span>
          <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>Travellers see only the photos you approve. ›</span>
        </Link>
      ) : null}
      {railsSummary ? <RailsToday summary={railsSummary} /> : null}
      <OperatorProfileSummary profile={profile} />
      <OperatorPayoutSettings profile={profile} hasDetailsOnFile={hasDetailsOnFile} />
      <OperatorCancellationPolicy
        tiers={savedTiers}
        platformDefault={PLATFORM_DEFAULT_CANCELLATION_TIERS}
        usingDefault={savedTiers.length === 0}
      />
      <OperatorListings listings={listings} editable={!profile.rezdySupplierId} />
      {/* An operator on the native rails has their bookings in Calendar and Bookings; the
          "not linked to a booking source" message below would no longer be true for them. */}
      {railsSummary && bookings.kind === "unlinked" ? null : <OperatorBookings bookings={bookings} />}
    </>
  );
}
