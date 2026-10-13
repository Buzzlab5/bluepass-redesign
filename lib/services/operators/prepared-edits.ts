import { mainPrice } from "@/lib/services/operators/main-price";
import type { PreparedOperator, PreparedPrice, PreparedTrip } from "@/lib/services/operators/prepared-pages";

/**
 * Corrections made while checking a prepared page. They are kept apart from what was read
 * off the operator's website and laid over it when the page is shown, so importing the
 * page again never undoes a correction, and the checking screen can always show what the
 * website says beside what Bluepass now says.
 *
 * Only what differs from the website is stored: setting a field back to the website's
 * value removes the correction.
 */

export type TripEdits = Partial<Pick<PreparedTrip,
  "title" | "summary" | "highlights" | "duration" | "departureTimes" | "season" | "departsFrom" |
  "prices" | "priceFrom" | "includes" | "bring" | "requirements" | "bookingLinks">>;

export type PageEdits = {
  summary?: string;
  standouts?: string[];
  contact?: { phone?: string | null; email?: string | null; address?: string | null };
};

type Kind = "text" | "textarea" | "lines" | "prices" | "money";
export type EditField = { name: string; label: string; kind: Kind; required?: boolean; ours?: boolean; hint?: string };

export const TRIP_FIELDS: EditField[] = [
  { name: "title", label: "Title", kind: "text", required: true },
  { name: "summary", label: "Summary", kind: "textarea", required: true, ours: true },
  { name: "highlights", label: "Highlights", kind: "lines", ours: true, hint: "One per line" },
  { name: "duration", label: "Duration", kind: "text" },
  { name: "departureTimes", label: "Departs", kind: "lines", hint: "One time per line" },
  { name: "season", label: "Season", kind: "text" },
  { name: "departsFrom", label: "Departs from", kind: "text" },
  { name: "prices", label: "Prices", kind: "prices", hint: "One per line: Adult = 120 (any note in brackets)" },
  { name: "priceFrom", label: "From price", kind: "money", hint: "Leave empty to use the main activity's adult price" },
  { name: "includes", label: "Includes", kind: "lines", hint: "One per line" },
  { name: "bring", label: "Bring", kind: "lines", hint: "One per line" },
  { name: "requirements", label: "Good to know", kind: "textarea" },
  { name: "bookingLinks", label: "Booking links", kind: "lines", hint: "One per line" },
];

export const PAGE_FIELDS: EditField[] = [
  { name: "summary", label: "Summary", kind: "textarea", required: true, ours: true },
  { name: "standouts", label: "Standouts", kind: "lines", ours: true, hint: "One per line" },
  { name: "phone", label: "Phone", kind: "text" },
  { name: "email", label: "Email", kind: "text" },
  { name: "address", label: "Address", kind: "text" },
];

function money(amount: number) {
  return Number.isInteger(amount) ? String(amount) : String(Number(amount.toFixed(2)));
}

/** A value as it appears in the form. */
export function fieldText(kind: Kind, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (kind === "lines") return (value as string[]).join("\n");
  if (kind === "prices") return (value as PreparedPrice[]).map((p) => `${p.label} = ${money(p.amount)}${p.note ? ` (${p.note})` : ""}`).join("\n");
  if (kind === "money") return money(value as number);
  return String(value);
}

const PRICE_LINE = /^(.+?)\s*=\s*(?:A\$|AU\$|\$|AUD\s*)?([\d,]+(?:\.\d+)?)\s*(?:\((.*)\))?\s*$/;

type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

/** What was typed, as a value; an empty optional field is "not set". */
export function parseField(field: EditField, text: string, currency: string): Parsed {
  const trimmed = text.replace(/\r/g, "").trim();
  if (field.required && !trimmed) return { ok: false, message: `${field.label} cannot be empty.` };
  if (field.ours && trimmed.includes("—")) return { ok: false, message: `${field.label} has an em dash. Bluepass copy uses a comma or a full stop instead.` };
  switch (field.kind) {
    case "text":
    case "textarea":
      return { ok: true, value: trimmed || null };
    case "lines":
      return { ok: true, value: trimmed.split("\n").map((l) => l.trim()).filter(Boolean) };
    case "money": {
      if (!trimmed) return { ok: true, value: undefined };
      const amount = Number(trimmed.replace(/[$,\s]|A\$|AUD/g, ""));
      return amount > 0 ? { ok: true, value: amount } : { ok: false, message: `${field.label} must be an amount, like 120.` };
    }
    case "prices": {
      const prices: PreparedPrice[] = [];
      for (const line of trimmed.split("\n").map((l) => l.trim()).filter(Boolean)) {
        const m = line.match(PRICE_LINE);
        if (!m) return { ok: false, message: `The price line "${line}" needs the form: Adult = 120` };
        prices.push({ label: m[1].trim(), amount: Number(m[2].replace(/,/g, "")), currency, ...(m[3]?.trim() ? { note: m[3].trim() } : {}) });
      }
      return { ok: true, value: prices };
    }
  }
}

/** Equal for the purposes of a correction: an empty list, an empty text and "not set" are the same. */
function same(kind: Kind, a: unknown, b: unknown) {
  const norm = (v: unknown) => {
    if (v === undefined || v === null || v === "") return null;
    if (Array.isArray(v) && v.length === 0) return null;
    if (kind === "prices") return (v as PreparedPrice[]).map((p) => [p.label, p.amount, p.note || null]);
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

type Diff<T> = { ok: true; edits: T } | { ok: false; message: string };

function diff(fields: EditField[], form: Record<string, string>, website: Record<string, unknown>, currency: string): Diff<Record<string, unknown>> {
  const edits: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field.name in form)) continue;
    const parsed = parseField(field, form[field.name], currency);
    if (!parsed.ok) return parsed;
    // An empty From price means "work it out", which is never a correction.
    if (field.kind === "money" && parsed.value === undefined) continue;
    if (!same(field.kind, parsed.value, website[field.name])) edits[field.name] = parsed.value;
  }
  return { ok: true, edits };
}

export function tripEditsFrom(website: PreparedTrip, form: Record<string, string>): Diff<TripEdits> {
  const currency = website.prices?.[0]?.currency ?? "AUD";
  // The From price the website gives is the worked-out one, so a typed amount equal to it is no correction.
  return diff(TRIP_FIELDS, form, website as unknown as Record<string, unknown>, currency) as Diff<TripEdits>;
}

export function pageEditsFrom(website: PreparedOperator, form: Record<string, string>): Diff<PageEdits> {
  const flat = { summary: website.summary, standouts: website.standouts, phone: website.contact?.phone, email: website.contact?.email, address: website.contact?.address };
  const result = diff(PAGE_FIELDS, form, flat, "AUD");
  if (!result.ok) return result;
  const { phone, email, address, ...rest } = result.edits as Record<string, unknown>;
  const contact = Object.fromEntries(Object.entries({ phone, email, address }).filter(([, v]) => v !== undefined));
  return { ok: true, edits: { ...rest, ...(Object.keys(contact).length ? { contact } : {}) } as PageEdits };
}

/** The trip as shown: the website's facts with any corrections laid over them. */
export function applyTripEdits(trip: PreparedTrip, edits: TripEdits | null | undefined): PreparedTrip {
  if (!edits || !Object.keys(edits).length) return trip;
  const shown: PreparedTrip = { ...trip, ...edits };
  if (edits.priceFrom !== undefined) {
    shown.priceFromLabel = null;
  } else if (edits.prices) {
    const main = mainPrice(edits.prices);
    shown.priceFrom = main?.amount ?? null;
    shown.priceFromLabel = main?.label ?? null;
  }
  return shown;
}

export function applyPageEdits(page: PreparedOperator, edits: PageEdits | null | undefined): PreparedOperator {
  if (!edits || !Object.keys(edits).length) return page;
  const { contact, ...rest } = edits;
  return { ...page, ...rest, ...(contact ? { contact: { ...page.contact, ...contact } } : {}) };
}

/** The website's value for a field, for showing beside a correction. */
export function websiteValue(fields: EditField[], name: string, website: Record<string, unknown>) {
  const field = fields.find((f) => f.name === name);
  return field ? fieldText(field.kind, website[name]) : "";
}
