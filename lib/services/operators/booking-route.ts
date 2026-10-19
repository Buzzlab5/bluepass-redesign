import type { PreparedOperator, PreparedTrip } from "@/lib/services/operators/prepared-pages";

/**
 * How a traveller books a trip on a prepared page, before the operator connects their
 * booking system to Bluepass. A trip with its own booking link opens that trip on the
 * operator's booking page, where the times and prices are live. A trip with none on the
 * website (private charters, school and corporate groups) is booked by asking, so the
 * page says so rather than pretending there is a calendar.
 */
export type BookingRoute =
  | { kind: "online"; url: string }
  | { kind: "enquire"; url: string; email: string | null; phone: string | null };

function https(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function bookingRoute(trip: PreparedTrip, page: Pick<PreparedOperator, "website" | "contact">): BookingRoute {
  const direct = (trip.bookingLinks ?? []).map(https).find(Boolean);
  if (direct) return { kind: "online", url: direct };
  const email = page.contact?.email?.trim() || null;
  return {
    kind: "enquire",
    // The trip's own page on their website usually carries the enquiry form.
    url: https(trip.sourceUrl) ?? https(page.website) ?? (email ? `mailto:${email}` : "#"),
    email,
    phone: page.contact?.phone?.trim() || null,
  };
}
