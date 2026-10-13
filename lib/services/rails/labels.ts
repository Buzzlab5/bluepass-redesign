import type { PricedLine } from "@/lib/services/operators/listing-availability";
import { formatMoney } from "@/lib/services/rails/money";

/** The words an operator sees for a booking's state. Shared so every screen says the same thing. */

export type Tone = "good" | "warn" | "bad" | "muted";

export function paymentLabel(b: { paymentStatus: string; totalCents: number; currency: string; refundedCents?: number }): { label: string; tone: Tone } {
  switch (b.paymentStatus) {
    case "PAID": return { label: "Paid online", tone: "good" };
    case "PAID_TO_OPERATOR": return { label: "Paid to you", tone: "good" };
    case "PAID_VIA_CHANNEL": return { label: "Paid via Rezdy", tone: "good" };
    case "REFUNDED": return { label: "Refunded", tone: "muted" };
    case "PARTIALLY_REFUNDED": return { label: "Part refunded", tone: "muted" };
    default:
      return b.totalCents > 0 ? { label: `To collect ${formatMoney(b.totalCents, b.currency)}`, tone: "warn" } : { label: "No price set", tone: "muted" };
  }
}

export function statusLabel(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "CONFIRMED": return { label: "Confirmed", tone: "good" };
    case "PENDING_PAYMENT": return { label: "Paying now", tone: "warn" };
    case "REQUESTED": return { label: "Accept in Rezdy", tone: "warn" };
    case "CANCELLED": return { label: "Cancelled", tone: "bad" };
    case "EXPIRED": return { label: "Not completed", tone: "muted" };
    default: return { label: status, tone: "muted" };
  }
}

export function sourceLabel(source: string) {
  return source === "ONLINE" ? "Booking page" : source === "KAI" ? "Kai" : "Taken by you";
}

/** Where a trip's seats live, in the operator's words. */
export function channelLabel(channel: string) {
  return channel === "REZDY" ? "Rezdy" : channel === "FAREHARBOR" ? "FareHarbor" : "Bluepass";
}

/** "2 Adult, 1 Child 4 to 14", or "5 guests" for a head-count booking. */
export function partyText(allLines: PricedLine[], guests: number) {
  // Taxes and fees a booking system adds are part of the price, not of the party.
  const lines = allLines.filter((l) => l.rateId !== "fees" && !l.rateId.startsWith("extra:"));
  if (lines.length === 0 || (lines.length === 1 && lines[0].rateId === "manual")) return `${guests} ${guests === 1 ? "guest" : "guests"}`;
  const text = lines.map((l) => (l.perGuest ? `${l.quantity} ${l.label}` : l.label)).join(", ");
  const perGuestSeats = lines.filter((l) => l.perGuest).reduce((n, l) => n + l.quantity, 0);
  return perGuestSeats === guests ? text : `${text} · ${guests} ${guests === 1 ? "guest" : "guests"}`;
}

/** "Underwater camera hire × 2, Hotel pickup × 3": the add-ons on a booking, or null when none. */
export function extrasText(lines: PricedLine[]): string | null {
  const extras = lines.filter((l) => l.rateId.startsWith("extra:"));
  return extras.length ? extras.map((l) => (l.quantity > 1 ? `${l.label} × ${l.quantity}` : l.label)).join(", ") : null;
}
