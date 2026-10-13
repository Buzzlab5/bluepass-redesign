"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { importReport, previewReport, type ReportRow } from "@/lib/services/channels/fareharbor/report";
import { rezdyApi } from "@/lib/services/channels/rezdy/api";
import { reconcileRezdyBookings } from "@/lib/services/channels/rezdy/booking";
import { runRezdyChannelSync } from "@/lib/services/channels/rezdy/sync";
import { railsPayments } from "@/lib/services/rails/payments";

export type ReportState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "preview"; csv: string; rows: ReportRow[]; columns: Record<string, string | null> }
  | { status: "done"; message: string };

export type SyncState = { status: "idle" } | { status: "done"; message: string } | { status: "error"; message: string };

const ADMIN_GONE = "Your admin session is no longer valid. Sign in again.";

/** Reads the pasted report and shows what would be imported. Writes nothing. */
export async function previewFareHarborReportAction(_prev: ReportState, form: FormData): Promise<ReportState> {
  if (!(await requireCurrentAdmin())) return { status: "error", message: ADMIN_GONE };
  const csv = String(form.get("csv") ?? "");
  if (!csv.trim()) return { status: "error", message: "Paste the report first, or choose its CSV file." };
  const preview = await previewReport(csv);
  if (!preview.ok) return { status: "error", message: preview.message };
  const columns = Object.fromEntries(Object.entries(preview.columns).map(([k, i]) => [k, i === null ? null : preview.headers[i]]));
  return { status: "preview", csv, rows: preview.rows, columns };
}

export async function importFareHarborReportAction(_prev: ReportState, form: FormData): Promise<ReportState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return { status: "error", message: ADMIN_GONE };
  const result = await importReport(String(form.get("csv") ?? ""), admin.email);
  revalidatePath("/admin/channels");
  return result.ok ? { status: "done", message: `Imported. ${result.message}` } : { status: "error", message: result.message };
}

/** The 15-minute channel run, now: trips from Rezdy, and Rezdy-side cancellations and moves. */
export async function runChannelSyncAction(_prev: SyncState): Promise<SyncState> {
  if (!(await requireCurrentAdmin())) return { status: "error", message: ADMIN_GONE };
  const api = rezdyApi();
  if (!api) return { status: "error", message: "REZDY_API_KEY is not set." };
  const bookings = await reconcileRezdyBookings(new Date(), api, railsPayments());
  const trips = await runRezdyChannelSync(new Date(), api);
  revalidatePath("/admin/channels");
  const t = trips as { connections?: number; created?: number; updated?: number; failed?: number };
  const b = bookings as { seen?: number; updated?: number };
  return { status: "done", message: `${t.connections ?? 0} connections checked (${t.created ?? 0} new trips, ${t.updated ?? 0} updated, ${t.failed ?? 0} failed); ${b.seen ?? 0} changed orders read, ${b.updated ?? 0} applied.` };
}
