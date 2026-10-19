"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { markHandled } from "@/lib/services/outreach/admin";
import { runOutreachBatch } from "@/lib/services/outreach/runner";

export type OutreachAdminState = { status: "idle" } | { status: "done" | "error"; message: string };

const SIGNED_OUT: OutreachAdminState = { status: "error", message: "Your admin session is no longer valid. Sign in again." };

export async function markHandledAction(eventId: string): Promise<OutreachAdminState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return SIGNED_OUT;
  await markHandled(eventId, admin.email);
  revalidatePath("/admin/outreach");
  return { status: "done", message: "Marked as handled." };
}

export async function sendBatchAction(): Promise<OutreachAdminState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return SIGNED_OUT;
  const result = await runOutreachBatch();
  revalidatePath("/admin/outreach");
  if (!result.live) return { status: "done", message: result.notes[0] ?? "Rehearsal: nothing was sent." };
  return { status: "done", message: `${result.enrolled} added to Instantly. ${result.notes.join(" ")}` };
}
