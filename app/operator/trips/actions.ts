"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOperatorAccess } from "@/lib/services/operator/guard";
import {
  deleteOperatorTrip,
  publishOperatorTrip,
  saveOperatorTrip,
  unpublishOperatorTrip,
} from "@/lib/services/operator/native-trips";
import type { TripEditorValues } from "@/lib/services/operator/native-trip-editor";

export type TripActionState = { status: "idle" } | { status: "done"; message: string } | { status: "error"; message: string };

/* The editor posts its whole state as one JSON field, so a trip with many ticket rows, departure
   times and blocked dates arrives as one value instead of dozens of parallel lists. Everything is
   re-validated on the server: the browser is not trusted to have sent a sane shape. */
const editorSchema = z.object({
  title: z.string().max(200),
  category: z.string().max(80),
  region: z.string().max(120),
  description: z.string().max(4000),
  durationHours: z.string().max(10),
  meetingPoint: z.string().max(300),
  photoUrls: z.array(z.string().max(500)).max(8),
  currency: z.string().max(3),
  timeZone: z.string().max(60),
  tickets: z.array(z.object({ label: z.string().max(60), price: z.string().max(12), kind: z.enum(["TICKET", "EXTRA"]) })).max(20),
  schedules: z
    .array(
      z.object({
        days: z.array(z.number().int().min(0).max(6)).max(7),
        time: z.string().max(5),
        seats: z.string().max(4),
        validFrom: z.string().max(10),
        validUntil: z.string().max(10),
      }),
    )
    .max(30),
  blackouts: z.array(z.object({ fromDate: z.string().max(10), toDate: z.string().max(10), reason: z.string().max(200) })).max(100),
});

/** Re-derives the operator on every call: the page's check finished before this button existed. */
async function requireOperator() {
  const access = await currentOperatorAccess();

  if (!access.ok) {
    return {
      failure: {
        status: "error" as const,
        message:
          access.reason === "SIGNED_OUT"
            ? "Your session has expired. Sign in again and retry. Nothing was changed."
            : "This account can no longer manage trips. Nothing was changed.",
      },
    };
  }

  return { access };
}

function readEditor(formData: FormData): TripEditorValues | null {
  const raw = formData.get("editor");
  if (typeof raw !== "string") return null;

  try {
    const parsed = editorSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Saves the trip. With intent "publish" it also puts the trip on sale and on bluepass.co. */
export async function saveTripAction(tripId: string | null, _previous: TripActionState, formData: FormData): Promise<TripActionState> {
  const { access, failure } = await requireOperator();
  if (failure) return failure;

  const values = readEditor(formData);
  if (!values) return { status: "error", message: "That form was malformed. Reload the page and try again." };

  const saved = await saveOperatorTrip(access.profile, tripId, values);
  if (!saved.ok) return { status: "error", message: saved.message };

  let takenDown = saved.listingTakenDown;
  if (formData.get("intent") === "publish") {
    const published = await publishOperatorTrip(access.profile, saved.trip.id);
    if (!published.ok) {
      /* The trip is saved; only the publish step failed. Say so, so the operator does not retype it. */
      if (!tripId) redirect(`/operator/trips/${saved.trip.id}?notice=${encodeURIComponent(`Saved as a draft. ${published.message}`)}`);
      return { status: "error", message: `Your changes are saved, but the trip is not published. ${published.message}` };
    }
    takenDown = published.listingTakenDown;
  }

  revalidatePath("/operator/trips");

  const notice =
    formData.get("intent") === "publish"
      ? takenDown
        ? "Trip published and ready to book. Its page on bluepass.co was switched off by Bluepass. Contact Bluepass to have it turned back on."
        : "Trip published. Travellers can now see it and book it."
      : "Draft saved.";

  if (!tripId) redirect(`/operator/trips/${saved.trip.id}?notice=${encodeURIComponent(notice)}`);
  return { status: "done", message: notice };
}

export async function unpublishTripAction(tripId: string, _previous: TripActionState, _formData: FormData): Promise<TripActionState> {
  const { access, failure } = await requireOperator();
  if (failure) return failure;

  const result = await unpublishOperatorTrip(access.profile, tripId);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/operator/trips");
  revalidatePath(`/operator/trips/${tripId}`);
  return { status: "done", message: "Trip unpublished. Travellers can no longer book it. Existing bookings are not affected." };
}

export async function deleteTripAction(tripId: string, _previous: TripActionState, _formData: FormData): Promise<TripActionState> {
  const { access, failure } = await requireOperator();
  if (failure) return failure;

  const result = await deleteOperatorTrip(access.profile, tripId);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/operator/trips");
  redirect("/operator/trips");
}
