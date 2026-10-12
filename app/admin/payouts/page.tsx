import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import CommissionLedger from "@/components/admin/CommissionLedger";
import CronHealth from "@/components/admin/CronHealth";
import LedgerSection, { type LedgerTenantView } from "@/components/admin/LedgerSection";
import PartnerPayoutRequests from "@/components/admin/PartnerPayoutRequests";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { listPendingPartnerPayoutRequests } from "@/lib/services/admin/partner-payouts";
import {
  isLedgerStatusFilter,
  loadAustraliaLedger,
  loadCommissionLedger,
  loadCronHealth,
  loadIndonesiaLedger,
  toAustraliaLedgerRow,
  toIndonesiaLedgerRow,
  type LedgerRowView,
  type LedgerStatusFilter,
  type TenantSection,
} from "@/lib/services/admin/payouts";

export const metadata = { title: "Payouts & Ledger · Bluepass Admin" };

const FILTERS: { value: LedgerStatusFilter; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "FINALIZED", label: "Finalized" },
  { value: "VOIDED", label: "Voided" },
  { value: "ALL", label: "All" },
];

const KAI_HINT =
  "Check KAI_CORE_ADMIN_TOKEN in this app's env matches KAI_ADMIN_TOKEN in Kai's, and that KAI_CORE_BASE_URL points at the right Kai deployment.";

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdminOrRedirect("/admin/payouts");

  const params = await searchParams;
  /* PENDING by default, not FINALIZED: a line that has been sitting unpaid for days is the thing
     this page is for. Kai's own endpoints default to FINALIZED, which is the opposite bias. */
  const status: LedgerStatusFilter = isLedgerStatusFilter(params.status) ? params.status : "PENDING";

  const [cron, australia, indonesia, commission, partnerPayoutRequests] = await Promise.all([
    loadCronHealth(),
    loadAustraliaLedger(status),
    loadIndonesiaLedger(status),
    loadCommissionLedger(),
    listPendingPartnerPayoutRequests(),
  ]);

  return (
    <>
      <AdminPageHeader
        title="Payouts & Ledger"
        support="Operator payouts run unattended on both the Australia and Indonesia paths. This is where you check they actually ran, and what each one paid."
      />

      <CronHealth kai={cron.kai} local={cron.local} />

      <div className="adm-filter" role="group" aria-label="Ledger status filter">
        <span className="ds-micro adm-filter__label">Ledger status</span>
        <div className="adm-filter__options">
          {FILTERS.map((filter) => (
            <Link
              key={filter.value}
              href={`/admin/payouts?status=${filter.value}`}
              className={`ds-body-sm adm-filter__option ${status === filter.value ? "is-active" : ""}`}
              aria-current={status === filter.value ? "true" : undefined}
              scroll={false}
            >
              {filter.label}
            </Link>
          ))}
        </div>
      </div>

      <LedgerSection
        title="Australia · Rezdy"
        blurb="Direct-PMS bookings. Both Kai tenants carrying AU traffic are queried — bluepass-au is a second tenant also named Boattime Yacht Charters, so neither is assumed to be the real one."
        tenants={toViews(australia, toAustraliaLedgerRow)}
        hint={KAI_HINT}
      />

      <LedgerSection
        title="Indonesia · BluePass"
        blurb="Marketplace inquiries: partner commission, platform commission, conservation allocation, and the operator payout line."
        tenants={toViews(indonesia, toIndonesiaLedgerRow)}
        hint={KAI_HINT}
      />

      <PartnerPayoutRequests requests={partnerPayoutRequests} />

      <CommissionLedger result={commission} />
    </>
  );
}

/** Maps each tenant's raw entries through its country-specific normaliser, preserving failures. */
function toViews<T>(
  sections: TenantSection<T>[],
  toRow: (entry: T, tenantSlug: string) => LedgerRowView,
): LedgerTenantView[] {
  return sections.map((section) => ({
    tenantSlug: section.tenantSlug,
    result: section.result.ok
      ? { ok: true as const, data: section.result.data.map((entry) => toRow(entry, section.tenantSlug)) }
      : section.result,
  }));
}
