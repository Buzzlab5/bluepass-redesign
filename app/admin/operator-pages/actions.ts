"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { approveWaitingTrips, setPageCheck, setPageEdits, setTripCheck, setTripEdits, type QcStatus } from "@/lib/services/operators/prepared-pages";

export type CheckState = { status: "idle" } | { status: "done"; message: string } | { status: "error"; message: string };

const STATUSES = new Set<QcStatus>(["pending", "approved", "needs_fix"]);

function read(form: FormData) {
  const status = String(form.get("status") ?? "") as QcStatus;
  const notes = String(form.get("notes") ?? "").trim() || null;
  return { status, notes };
}

export async function checkTripAction(listingId: string, slug: string, _prev: CheckState, form: FormData): Promise<CheckState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return { status: "error", message: "Your admin session is no longer valid. Sign in again." };
  const { status, notes } = read(form);
  if (!STATUSES.has(status)) return { status: "error", message: "Pick approve or needs a fix." };
  if (status === "needs_fix" && !notes) return { status: "error", message: "Say what needs fixing, so it can be fixed." };
  const result = await setTripCheck({ listingId, status, notes, reviewer: admin.email });
  revalidatePath(`/admin/operator-pages/${slug}`);
  revalidatePath("/admin/operator-pages");
  revalidatePath(`/operators/${slug}`);
  return result.ok ? { status: "done", message: result.message } : { status: "error", message: result.message };
}

export async function checkPageAction(slug: string, _prev: CheckState, form: FormData): Promise<CheckState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return { status: "error", message: "Your admin session is no longer valid. Sign in again." };
  const { status, notes } = read(form);
  if (!STATUSES.has(status)) return { status: "error", message: "Pick approve or needs a fix." };
  if (status === "needs_fix" && !notes) return { status: "error", message: "Say what needs fixing, so it can be fixed." };
  const result = await setPageCheck({ slug, status, notes, reviewer: admin.email });
  revalidatePath(`/admin/operator-pages/${slug}`);
  revalidatePath("/admin/operator-pages");
  revalidatePath(`/operators/${slug}`);
  return result.ok ? { status: "done", message: result.message } : { status: "error", message: result.message };
}

export async function approveWaitingTripsAction(slug: string, _prev: CheckState): Promise<CheckState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return { status: "error", message: "Your admin session is no longer valid. Sign in again." };
  const result = await approveWaitingTrips({ slug, reviewer: admin.email });
  revalidatePath(`/admin/operator-pages/${slug}`);
  revalidatePath("/admin/operator-pages");
  revalidatePath(`/operators/${slug}`);
  return result.ok ? { status: "done", message: result.message } : { status: "error", message: result.message };
}

function formFields(form: FormData) {
  return Object.fromEntries([...form.entries()].filter(([k, v]) => !k.startsWith("$") && typeof v === "string") as [string, string][]);
}

export async function editTripAction(listingId: string, slug: string, _prev: CheckState, form: FormData): Promise<CheckState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return { status: "error", message: "Your admin session is no longer valid. Sign in again." };
  const result = await setTripEdits({ listingId, form: formFields(form), editor: admin.email });
  revalidatePath(`/admin/operator-pages/${slug}`);
  revalidatePath("/admin/operator-pages");
  revalidatePath(`/operators/${slug}`);
  return result.ok ? { status: "done", message: result.message } : { status: "error", message: result.message };
}

export async function editPageAction(slug: string, _prev: CheckState, form: FormData): Promise<CheckState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return { status: "error", message: "Your admin session is no longer valid. Sign in again." };
  const result = await setPageEdits({ slug, form: formFields(form), editor: admin.email });
  revalidatePath(`/admin/operator-pages/${slug}`);
  revalidatePath(`/operators/${slug}`);
  return result.ok ? { status: "done", message: result.message } : { status: "error", message: result.message };
}
