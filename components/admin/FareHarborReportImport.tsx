"use client";

import { useActionState, useState } from "react";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import {
  importFareHarborReportAction,
  previewFareHarborReportAction,
  runChannelSyncAction,
  type ReportState,
  type SyncState,
} from "@/app/admin/channels/actions";

const IDLE: ReportState = { status: "idle" };

function money(cents: number | null, currency: string | null) {
  if (cents === null) return "";
  return `${currency ?? ""} ${(cents / 100).toFixed(2)}`.trim();
}

/**
 * Paste FareHarbor's affiliate report (or choose the CSV), check what Bluepass reads from
 * it, then import. Only rows whose voucher number is one of Bluepass's own hand-offs are
 * imported; the rest are listed so they can be followed up.
 */
export default function FareHarborReportImport() {
  const [preview, previewAction, previewing] = useActionState(previewFareHarborReportAction, IDLE);
  const [result, importAction, importing] = useActionState(importFareHarborReportAction, IDLE);
  const [csv, setCsv] = useState("");

  async function readFile(file: File | undefined) {
    if (file) setCsv(await file.text());
  }

  if (result.status === "done") return <Notice tone="success">{result.message}</Notice>;

  return (
    <div className="adm-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <form action={previewAction} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label className="ds-micro" htmlFor="fh-report">Affiliate report, as CSV</label>
        <input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} />
        <textarea
          id="fh-report"
          name="csv"
          rows={6}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder="Booking #,Voucher #,Item,Start,Customers,Total,Commission,Status"
          className="afield__input"
          style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, padding: 12, borderRadius: 12, border: "1px solid var(--color-hairline)", background: "var(--color-surface-1)", color: "var(--color-ink)" }}
        />
        <div>
          <Button type="submit" variant="secondary" magnetic={false} disabled={previewing || !csv.trim()}>{previewing ? "Reading…" : "Check the report"}</Button>
        </div>
      </form>

      {preview.status === "error" ? <Notice tone="error">{preview.message}</Notice> : null}
      {result.status === "error" ? <Notice tone="error">{result.message}</Notice> : null}

      {preview.status === "preview" ? (
        <>
          <p className="ds-caption">
            Read as: {Object.entries(preview.columns).filter(([, h]) => h).map(([k, h]) => `${k} = "${h}"`).join(", ")}.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="ds-caption" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>{["Line", "Booking", "Voucher", "Trip", "Start", "Guests", "Total", "Commission", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 8px" }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} style={{ borderTop: "1px solid var(--color-hairline)", opacity: r.problem ? 0.6 : 1 }}>
                    <td style={{ padding: "6px 8px" }}>{r.line}</td>
                    <td style={{ padding: "6px 8px" }}>{r.bookingId}</td>
                    <td style={{ padding: "6px 8px" }}>{r.voucher}</td>
                    <td style={{ padding: "6px 8px" }}>{r.match ? `${r.match.listingTitle} · ${r.match.operatorName}` : r.item}</td>
                    <td style={{ padding: "6px 8px" }}>{r.start}</td>
                    <td style={{ padding: "6px 8px" }}>{r.guests}</td>
                    <td style={{ padding: "6px 8px" }}>{money(r.totalCents, r.currency)}</td>
                    <td style={{ padding: "6px 8px" }}>{money(r.commissionCents, r.currency)}</td>
                    <td style={{ padding: "6px 8px" }}>{r.problem ?? (r.cancelled ? "Cancelled" : "Ready")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={importAction}>
            <input type="hidden" name="csv" value={preview.csv} />
            <Button type="submit" variant="primary" magnetic={false} disabled={importing || !preview.rows.some((r) => !r.problem)}>
              {importing ? "Importing…" : (() => { const n = preview.rows.filter((r) => !r.problem).length; return `Import ${n} ${n === 1 ? "booking" : "bookings"}`; })()}
            </Button>
          </form>
        </>
      ) : null}
    </div>
  );
}

const SYNC_IDLE: SyncState = { status: "idle" };

export function RunChannelSync() {
  const [state, action, pending] = useActionState(runChannelSyncAction, SYNC_IDLE);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      <Button type="submit" variant="secondary" magnetic={false} disabled={pending}>{pending ? "Running…" : "Run the Rezdy sync now"}</Button>
      {state.status !== "idle" ? <Notice tone={state.status === "done" ? "success" : "error"}>{state.message}</Notice> : null}
    </form>
  );
}
