"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { linkCreatorAccount, markInvited, resolveDispute } from "@/lib/services/onboarding/creator-admin";

export type CreatorAdminState = { status: "idle" } | { status: "done" | "error"; message: string };

const SIGNED_OUT: CreatorAdminState = { status: "error", message: "Your admin session is no longer valid. Sign in again." };

export async function markInvitedAction(creatorId: string): Promise<CreatorAdminState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return SIGNED_OUT;
  await markInvited({ creatorId, by: admin.email });
  revalidatePath("/admin/creators");
  return { status: "done", message: "Marked as invited." };
}

export async function linkAccountAction(creatorId: string, _prev: CreatorAdminState, form: FormData): Promise<CreatorAdminState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return SIGNED_OUT;
  const partnerProfileId = String(form.get("partnerProfileId") ?? "");
  if (!partnerProfileId) return { status: "error", message: "Choose their account." };
  const result = await linkCreatorAccount({ creatorId, partnerProfileId });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/admin/creators");
  return { status: "done", message: "Linked. Their picks are in their portal now." };
}

export async function resolveDisputeAction(campaignId: string, pay: boolean): Promise<CreatorAdminState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return SIGNED_OUT;
  const result = await resolveDispute({ campaignId, pay });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/admin/creators");
  return { status: "done", message: pay ? "The creator will be paid." : "The credit is back with the operator." };
}
