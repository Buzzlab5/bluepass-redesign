"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { createAffiliateTrip, setAffiliateTripLive } from "@/lib/services/discover/affiliate-trips";

export type AffiliateTripState =
  | { status: "idle" }
  | { status: "done"; message: string; slug: string }
  | { status: "error"; message: string; field?: string };

const SESSION_EXPIRED = "Your admin session is no longer valid. Sign in again before adding a trip.";

/** Re-derives the admin itself, like every other write in this console: it publishes to the live site. */
export async function addAffiliateTripAction(_previous: AffiliateTripState, formData: FormData): Promise<AffiliateTripState> {
  const admin = await requireCurrentAdmin();
  if (!admin) return { status: "error", message: SESSION_EXPIRED };

  const text = (field: string) => {
    const value = formData.get(field);
    return typeof value === "string" ? value.trim() : "";
  };

  const result = await createAffiliateTrip({
    operatorName: text("operatorName"),
    title: text("title"),
    category: text("category"),
    region: text("region"),
    description: text("description"),
    heroImageUrl: text("heroImageUrl") || undefined,
    priceFrom: text("priceFrom"),
    currency: text("currency") || undefined,
    bookingPlatform: text("bookingPlatform"),
    bookingUrl: text("bookingUrl"),
  });

  if (!result.ok) return { status: "error", message: result.message, field: result.field };

  revalidatePath("/admin/affiliate-trips");
  revalidatePath("/");
  return { status: "done", message: "Added. It is live on the trips page now.", slug: result.slug };
}

export async function setAffiliateTripLiveAction(formData: FormData) {
  const admin = await requireCurrentAdmin();
  if (!admin) throw new Error(SESSION_EXPIRED);

  const listingId = String(formData.get("listingId") ?? "");
  const live = formData.get("live") === "true";
  const result = await setAffiliateTripLive(listingId, live, admin.email);
  if (!result.ok) throw new Error(result.message);

  revalidatePath("/admin/affiliate-trips");
  revalidatePath("/");
}
