"use server";

import { revalidatePath } from "next/cache";
import { decideKaiNativeBooking, KaiNativeError } from "@/lib/services/kai-core/native-admin";
import { currentOperatorAccess } from "@/lib/services/operator/guard";

export type BookingDecisionState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

/**
 * Accept or decline one paid booking. The operator and their Kai tenant come from the session, and
 * Kai only acts on a booking that belongs to that tenant, so a tampered id cannot touch another
 * operator's booking.
 */
export async function decideBookingAction(
  attemptId: string,
  decision: "ACCEPT" | "DECLINE",
  _previous: BookingDecisionState,
  formData: FormData,
): Promise<BookingDecisionState> {
  const access = await currentOperatorAccess();

  if (!access.ok) {
    return { status: "error", message: "Your session has expired. Sign in again and retry. Nothing was changed." };
  }

  const tenantSlug = access.profile.kaiTenantSlug;
  if (!tenantSlug) return { status: "error", message: "This account has no bookings to answer." };

  const noteField = formData.get("note");
  const note = typeof noteField === "string" && noteField.trim() ? noteField.trim().slice(0, 300) : undefined;

  try {
    const result = await decideKaiNativeBooking(tenantSlug, attemptId, decision, note);
    revalidatePath("/operator/bookings");

    switch (result.outcome) {
      case "CONFIRMED":
        return { status: "done", message: "Accepted. The traveller is confirmed." };
      case "REFUNDED":
        return { status: "done", message: "Declined. The traveller has been refunded in full." };
      case "REFUND_FAILED":
        return { status: "error", message: "Declined, but the refund did not go through. Bluepass has been alerted and will refund the traveller." };
      default:
        return { status: "done", message: "This booking was already answered." };
    }
  } catch (error) {
    return {
      status: "error",
      message: error instanceof KaiNativeError ? error.message : "Something went wrong. Nothing was changed. Try again.",
    };
  }
}
