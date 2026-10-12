import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import StatusPill, { type PillTone } from "@/components/admin/StatusPill";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { listPartnerProfiles } from "@/lib/services/admin/partner-directory";

export const metadata = { title: "Partners · Bluepass Admin" };

const STATUS_TONES: Record<string, PillTone> = {
  LIVE: "good",
  APPROVED: "good",
  PENDING_REVIEW: "warn",
  DECLINED: "bad",
};

export default async function PartnersPage() {
  await requireAdminOrRedirect("/admin/partners");

  const partners = await listPartnerProfiles();

  return (
    <>
      <AdminPageHeader
        title="Every partner profile"
        support={`${partners.length} profile${partners.length === 1 ? "" : "s"} — approved, declined, and still-pending alike. Open one to correct its category or notes.`}
      />

      {partners.length === 0 ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__body">No partner profiles yet.</p>
        </div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th className="ds-micro">Handle</th>
                <th className="ds-micro">Account</th>
                <th className="ds-micro">Status</th>
                <th className="ds-micro">Category</th>
                <th className="ds-micro">Referral name</th>
                <th className="ds-micro">Payout details</th>
                <th className="ds-micro"></th>
              </tr>
            </thead>
            <tbody>
              {partners.map((partner) => (
                <tr key={partner.id}>
                  <td className="ds-body-sm">{partner.handle ?? "—"}</td>
                  <td className="ds-body-sm">{partner.accountEmail}</td>
                  <td>
                    <StatusPill tone={STATUS_TONES[partner.status] ?? "muted"}>{partner.status}</StatusPill>
                  </td>
                  <td className="ds-body-sm">{formatPartnerCategory(partner.partnerCategory)}</td>
                  <td className="ds-body-sm">{partner.referralPartnerName ?? "—"}</td>
                  <td className="ds-body-sm">{partner.hasPayoutDetails ? "On file" : "—"}</td>
                  <td className="ds-body-sm">
                    <Link href={`/admin/partners/${partner.id}`}>Edit →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function formatPartnerCategory(category: string | null) {
  if (!category) return "—";
  return category
    .toLowerCase()
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
