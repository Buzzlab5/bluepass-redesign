import type { NativeTrip, NativeTripInput } from "@/lib/services/kai-core/native-admin";

/**
 * What the trip editor holds while an operator types, and how it converts to and from what Kai
 * stores. Everything here is a string or a plain list so a half-filled form is representable; the
 * strict checking happens once, on the server, in `editorToKaiInput`.
 */

export const TRIP_CATEGORIES = ["Sail & Yacht", "Dive", "Wildlife", "Expedition"] as const;

/** The currencies Kai's commission ledger can book. Barbados trips are priced in USD for now. */
export const TRIP_CURRENCIES = ["USD", "AUD", "EUR", "IDR"] as const;

export const TRIP_TIME_ZONES: { value: string; label: string }[] = [
  { value: "America/Barbados", label: "Barbados" },
  { value: "Asia/Makassar", label: "Bali, Komodo, Sulawesi (WITA)" },
  { value: "Asia/Jakarta", label: "Java, Sumatra (WIB)" },
  { value: "Asia/Jayapura", label: "Raja Ampat, Papua (WIT)" },
  { value: "Australia/Brisbane", label: "Queensland" },
  { value: "Australia/Sydney", label: "New South Wales, Victoria" },
  { value: "Australia/Perth", label: "Western Australia" },
  { value: "Australia/Darwin", label: "Northern Territory" },
  { value: "Pacific/Fiji", label: "Fiji" },
];

export const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

export type TripEditorValues = {
  title: string;
  category: string;
  region: string;
  description: string;
  durationHours: string;
  meetingPoint: string;
  photoUrls: string[];
  currency: string;
  timeZone: string;
  tickets: { label: string; price: string; kind: "TICKET" | "EXTRA" }[];
  schedules: { days: number[]; time: string; seats: string; validFrom: string; validUntil: string }[];
  blackouts: { fromDate: string; toDate: string; reason: string }[];
};

export const EMPTY_TRIP_EDITOR: TripEditorValues = {
  title: "",
  category: TRIP_CATEGORIES[0],
  region: "",
  description: "",
  durationHours: "2",
  meetingPoint: "",
  photoUrls: [""],
  currency: "USD",
  timeZone: "America/Barbados",
  tickets: [{ label: "Adult", price: "", kind: "TICKET" }],
  schedules: [{ days: [], time: "09:00", seats: "", validFrom: "", validUntil: "" }],
  blackouts: [],
};

/** "95", "95.5" and "95,50" are prices; "", "abc" and "-3" are not. Returns whole cents, or null. */
export function priceToCents(value: string): number | null {
  const normalised = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null;
  return Math.round(Number(normalised) * 100);
}

export function centsToPrice(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

function hoursToMinutes(value: string): number | null {
  const hours = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return Math.round(hours * 60);
}

export type EditorConversion =
  | { ok: true; input: NativeTripInput; category: string; region: string }
  | { ok: false; message: string };

/** Turns what the operator typed into what Kai stores. Anything unreadable is named, not guessed. */
export function editorToKaiInput(values: TripEditorValues): EditorConversion {
  const category = values.category.trim();
  const region = values.region.trim();
  if (region.length < 2) return { ok: false, message: "Say where the trip runs, for example Barbados West Coast." };
  if (category.length < 2) return { ok: false, message: "Pick a category." };

  const durationMinutes = hoursToMinutes(values.durationHours);
  if (durationMinutes === null) return { ok: false, message: "Enter how long the trip lasts, in hours." };

  const tickets: NativeTripInput["tickets"] = [];
  for (const ticket of values.tickets) {
    if (!ticket.label.trim() && !ticket.price.trim()) continue;
    const priceCents = priceToCents(ticket.price);
    if (priceCents === null) {
      return { ok: false, message: `Enter a price for "${ticket.label.trim() || "each ticket"}", like 95 or 95.50.` };
    }
    tickets.push({ label: ticket.label.trim(), priceCents, kind: ticket.kind, active: true });
  }

  const schedules: NativeTripInput["schedules"] = [];
  for (const schedule of values.schedules) {
    if (schedule.days.length === 0 && !schedule.seats.trim()) continue;
    const seats = Number(schedule.seats.trim());
    if (!Number.isInteger(seats) || seats < 1) {
      return { ok: false, message: "Enter how many seats each departure has." };
    }
    schedules.push({
      daysOfWeek: [...schedule.days].sort((a, b) => a - b),
      localTime: schedule.time.trim(),
      seats,
      validFrom: schedule.validFrom.trim() || null,
      validUntil: schedule.validUntil.trim() || null,
      active: true,
    });
  }

  const blackouts: NativeTripInput["blackouts"] = values.blackouts
    .filter((blackout) => blackout.fromDate.trim() || blackout.toDate.trim())
    .map((blackout) => ({
      fromDate: blackout.fromDate.trim(),
      toDate: blackout.toDate.trim() || blackout.fromDate.trim(),
      reason: blackout.reason.trim() || null,
    }));

  return {
    ok: true,
    category,
    region,
    input: {
      title: values.title.trim(),
      description: values.description.trim(),
      durationMinutes,
      meetingPoint: values.meetingPoint.trim(),
      photoUrls: values.photoUrls.map((url) => url.trim()).filter(Boolean),
      currency: values.currency,
      timeZone: values.timeZone,
      tickets,
      schedules,
      blackouts,
    },
  };
}

/** A saved trip (plus the category and region kept on its website listing) back into editor fields. */
export function tripToEditor(trip: NativeTrip, listing: { category: string; region: string } | null): TripEditorValues {
  return {
    title: trip.title,
    category: listing?.category ?? TRIP_CATEGORIES[0],
    region: listing?.region ?? "",
    description: trip.description,
    durationHours: String(Math.round((trip.durationMinutes / 60) * 100) / 100),
    meetingPoint: trip.meetingPoint,
    photoUrls: trip.photoUrls.length > 0 ? trip.photoUrls : [""],
    currency: trip.currency,
    timeZone: trip.timeZone,
    tickets: trip.tickets.map((ticket) => ({ label: ticket.label, price: centsToPrice(ticket.priceCents), kind: ticket.kind })),
    schedules: trip.schedules.map((schedule) => ({
      days: schedule.daysOfWeek,
      time: schedule.localTime,
      seats: String(schedule.seats),
      validFrom: schedule.validFrom ?? "",
      validUntil: schedule.validUntil ?? "",
    })),
    blackouts: trip.blackouts.map((blackout) => ({ fromDate: blackout.fromDate, toDate: blackout.toDate, reason: blackout.reason ?? "" })),
  };
}

export function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
