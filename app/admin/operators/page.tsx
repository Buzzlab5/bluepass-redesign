import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import StatusPill, { type PillTone } from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { listOperatorProfiles } from "@/lib/services/admin/operator-edit";

export const metadata = { title: "Operators · Bluepass Admin" };

const STATUS_TONES: Record<string, PillTone> = {
  LIVE: "good",
  APPROVED: "good",
  PENDING_REVIEW: "warn",
  DECLINED: "bad",
};

export default async function OperatorsPage() {
  await requireAdminOrRedirect("/admin/operators");

  const operators = await listOperatorProfiles();

  return (
    <>
      <AdminPageHeader
        title="Every operator profile"
        support={`${operators.length} profile${operators.length === 1 ? "" : "s"} — manually onboarded and Rezdy-synced alike. Open one to correct its details.`}
        aside={
          <Link href="/admin/operators/new">
            <Button variant="primary" magnetic={false}>
              + New operator
            </Button>
          </Link>
        }
      />

      {operators.length === 0 ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__body">No operator profiles yet.</p>
        </div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th className="ds-micro">Company</th>
                <th className="ds-micro">Status</th>
                <th className="ds-micro">Payout method</th>
                <th className="ds-micro">Country</th>
                <th className="ds-micro">Rezdy</th>
                <th className="ds-micro">Payout on file</th>
                <th className="ds-micro"></th>
              </tr>
            </thead>
            <tbody>
              {operators.map((operator) => (
                <tr key={operator.id}>
                  <td className="ds-body-sm">{operator.companyName ?? operator.accountEmail}</td>
                  <td>
                    <StatusPill tone={STATUS_TONES[operator.status] ?? "muted"}>{operator.status}</StatusPill>
                  </td>
                  <td className="ds-body-sm">{formatPayoutMethod(operator.payoutMethod)}</td>
                  <td className="ds-body-sm">{operator.country ?? "—"}</td>
                  <td className="ds-body-sm">{operator.rezdySupplierId ? "Synced" : "—"}</td>
                  <td className="ds-body-sm">{operator.hasPayoutDetails ? "Yes" : "No"}</td>
                  <td className="ds-body-sm">
                    <Link href={`/admin/operators/${operator.id}`}>Edit →</Link>
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

function formatPayoutMethod(method: string) {
  if (method === "MANUAL_BANK_TRANSFER") return "Bank transfer";
  if (method === "STRIPE_CONNECT") return "Stripe Connect";
  if (method === "AIRWALLEX") return "Airwallex";
  return method;
}
