"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { confirmEmailInPerson } from "@/lib/services/operators/visits";

export type VisitActionState = { status: "idle" } | { status: "done" | "error"; message: string };

export async function confirmEmailAction(slug: string, _prev: VisitActionState, form: FormData): Promise<VisitActionState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return { status: "error", message: "Your admin session is no longer valid. Sign in again." };
  const result = await confirmEmailInPerson({ slug, email: String(form.get("email") ?? ""), actorEmail: admin.email });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/admin/visits/${slug}`);
  revalidatePath("/admin/visits");
  return { status: "done", message: `Saved. Ask them to scan the code: the claim link goes to ${result.email}.` };
}
