import { describe, expect, it } from "vitest";
import { guestsLine } from "@/lib/booking-party";

const line = (label: string, quantity: number, rateId = "r1") => ({ rateId, label, amountCents: 1000, quantity });

describe("guestsLine", () => {
  it("says a single kind of ticket once, not as a count and then again as a ticket", () => {
    expect(guestsLine({ guests: 2, lines: [line("Adult", 2)] })).toBe("2 × Adult");
    expect(guestsLine({ guests: 1, lines: [line("Adult", 1)] })).toBe("1 × Adult");
  });

  it("names a mixed party with its total first", () => {
    expect(guestsLine({ guests: 3, lines: [line("Adult", 2), line("Child", 1, "r2")] })).toBe("3 guests · 2 × Adult, Child");
  });

  it("does not pretend a per-booking price counts heads", () => {
    expect(guestsLine({ guests: 6, lines: [line("Private charter", 1)] })).toBe("6 guests · Private charter");
  });

  it("reads plainly for a phone booking taken without a price list", () => {
    expect(guestsLine({ guests: 4, lines: [line("Guests", 4, "manual")] })).toBe("4 guests");
    expect(guestsLine({ guests: 1, lines: [] })).toBe("1 guest");
  });

  it("leaves fees and add-ons out of the party", () => {
    expect(guestsLine({ guests: 2, lines: [line("Adult", 2), line("Port fee", 2, "fees"), line("Snorkel", 2, "extra:snorkel")] })).toBe("2 × Adult");
  });
});
