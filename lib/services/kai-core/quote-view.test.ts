import { describe, expect, it } from "vitest";
import { quoteView, type KaiCoreBluePassQuote } from "./quote-view";

const base: KaiCoreBluePassQuote = {
  id: "cmquote0000000000001",
  status: "READY_FOR_TRAVELLER",
  operationalStatus: "READY_FOR_TRAVELLER",
  selectedYachtName: "Alila Purnama",
  operatorName: "Alila Marine",
  destination: "Komodo",
  dateWindow: "20 July 2026",
  guests: 4,
  currency: "USD",
  grossPriceCents: 410000,
  conservationContributionCents: 20500,
  inclusions: null,
  exclusions: null,
  terms: null,
  paymentText: null,
  confirmationText: null,
};
const at = (operationalStatus: KaiCoreBluePassQuote["operationalStatus"], extra: Partial<KaiCoreBluePassQuote> = {}) => ({
  ...base,
  operationalStatus,
  ...extra,
});

describe("quoteView", () => {
  it("offers approval only while the quote is ready for the traveller", () => {
    expect(quoteView(at("READY_FOR_TRAVELLER")).action).toBe("approve");
    for (const stage of ["NEEDS_FINAL_PRICE", "TRAVELLER_APPROVED", "PAID", "BOOKING_CONFIRMED"] as const) {
      expect(quoteView(at(stage)).action).toBeNull();
    }
  });

  it("offers payment only when the operator has sent payment details and there is a price", () => {
    expect(quoteView(at("PAYMENT_READY")).action).toBe("pay");
    expect(quoteView(at("PAYMENT_READY", { grossPriceCents: null })).action).toBeNull();
    expect(quoteView(at("PAYMENT_READY", { grossPriceCents: 0 })).action).toBeNull();
  });

  it("never claims a booking or a charge before they exist", () => {
    for (const stage of ["NEEDS_FINAL_PRICE", "READY_FOR_TRAVELLER", "TRAVELLER_APPROVED", "PAYMENT_READY"] as const) {
      const text = `${quoteView(at(stage)).title} ${quoteView(at(stage)).lead}`;
      expect(text).not.toMatch(/you are booked|payment received|confirmed\./i);
    }
    expect(quoteView(at("BOOKING_CONFIRMED")).title).toBe("You are booked.");
  });

  it("names the operator, with a fallback", () => {
    expect(quoteView(at("NEEDS_FINAL_PRICE")).title).toContain("Alila Marine");
    expect(quoteView(at("NEEDS_FINAL_PRICE", { operatorName: null })).title).toContain("your operator");
  });

  it("shows the payment banners only where they apply", () => {
    expect(quoteView(at("PAYMENT_READY"), "success").banner).toMatch(/refresh/i);
    expect(quoteView(at("TRAVELLER_APPROVED"), "success").banner).toMatch(/refresh/i);
    expect(quoteView(at("PAYMENT_READY"), "cancelled").banner).toMatch(/not been charged/i);
    expect(quoteView(at("PAID"), "success").banner).toBeNull();
    expect(quoteView(at("READY_FOR_TRAVELLER"), "cancelled").banner).toBeNull();
    expect(quoteView(at("PAYMENT_READY")).banner).toBeNull();
  });
});
