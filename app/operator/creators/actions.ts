"use server";

import { revalidatePath } from "next/cache";
import { currentOperatorAccess } from "@/lib/services/operator/guard";
import { cancelPick, pickCreators, reportNotFeatured } from "@/lib/services/onboarding/creator-campaigns";

export type CreatorActionState = { status: "idle" } | { status: "done" | "error"; message: string };

const EXPIRED: CreatorActionState = { status: "error", message: "Your session has expired. Sign in again and retry. Nothing was changed." };

/** The operator's picks. The account comes from the session, never from the form. */
export async function pickCreatorsAction(_prev: CreatorActionState, form: FormData): Promise<CreatorActionState> {
  const access = await currentOperatorAccess();
  if (!access.ok) return EXPIRED;
  const result = await pickCreators({ accountId: access.account.id, creatorIds: form.getAll("creator").map(String) });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/operator/creators");
  revalidatePath("/operator");
  return { status: "done", message: "Sent. We will let you know as they answer." };
}

export async function cancelPickAction(campaignId: string): Promise<CreatorActionState> {
  const access = await currentOperatorAccess();
  if (!access.ok) return EXPIRED;
  const result = await cancelPick({ accountId: access.account.id, campaignId });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/operator/creators");
  return { status: "done", message: "Taken back. Their share is yours to give someone else." };
}

export async function reportNotFeaturedAction(campaignId: string): Promise<CreatorActionState> {
  const access = await currentOperatorAccess();
  if (!access.ok) return EXPIRED;
  const result = await reportNotFeatured({ accountId: access.account.id, campaignId });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/operator/creators");
  return { status: "done", message: "Thanks. We will look at it before any credit moves." };
}
