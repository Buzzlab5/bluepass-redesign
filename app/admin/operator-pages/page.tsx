import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import StatusPill from "@/components/admin/StatusPill";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { preparedPagesOverview } from "@/lib/services/operators/prepared-pages";

export const metadata = { title: "Prepared pages · Bluepass Admin" };
export const dynamic = "force-dynamic";

const PAGE_STATUS = {
  pending: { tone: "warn", label: "To check" },
  approved: { tone: "good", label: "Approved" },
  needs_fix: { tone: "bad", label: "Needs a fix" },
} as const;

/**
 * The checking queue for operator pages prepared from operators' own websites. Nothing
 * on them reaches a traveller until it is approved here, trip by trip.
 */
export default async function PreparedPagesAdmin() {
  await requireAdminOrRedirect("/admin/operator-pages");
  const pages = await preparedPagesOverview();
  const totals = pages.reduce((t, p) => ({ trips: t.trips + p.trips, approved: t.approved + p.approved }), { trips: 0, approved: 0 });

  return (
    <>
      <AdminPageHeader
        eyebrow="Operator pages"
        title="Prepared pages"
        support={pages.length
          ? `${pages.length} operators, ${totals.trips} trips, ${totals.approved} approved. Every fact was read from the operator's own website; check it against the source page linked beside it.`
          : "Nothing imported yet. Run scripts/import-operator-pages.ts."}
      />
      <div className="adm-card" style={{ padding: 0 }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {pages.map((p) => (
            <li key={p.slug} style={{ borderTop: "1px solid var(--color-hairline)" }}>
              <Link href={`/admin/operator-pages/${p.slug}`} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 16, alignItems: "center", padding: "14px 20px", textDecoration: "none", color: "inherit" }}>
                <span>
                  <span className="ds-body" style={{ display: "block" }}>{p.name}</span>
                  <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>
                    {p.where} · {p.approved} of {p.trips} {p.trips === 1 ? "trip" : "trips"} approved{p.needsFix ? ` · ${p.needsFix} need a fix` : ""}{p.flags.length ? ` · ${p.flags.join(", ")}` : ""}
                  </span>
                </span>
                <StatusPill tone={PAGE_STATUS[p.qcStatus].tone}>{PAGE_STATUS[p.qcStatus].label}</StatusPill>
                <span aria-hidden>›</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
