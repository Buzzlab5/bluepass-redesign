import { describe, expect, it } from "vitest";
import { extractKaiTravelIntent } from "./slot-extractor";

describe("extractKaiTravelIntent budget extraction", () => {
  it("prefers the currency-marked amount over a year in the same message", () => {
    const intent = extractKaiTravelIntent(
      "Komodo liveaboard for diving, 4 guests, first two weeks of December 2026, budget around $8,000",
      {},
    );

    expect(intent.budget).toBeDefined();
    expect(intent.budget).toContain("8,000");
    expect(intent.budget).not.toBe("2026");
  });

  it("does not treat a bare year as a budget", () => {
    const intent = extractKaiTravelIntent("First two weeks of December 2026", {});

    expect(intent.dateWindow).toBeDefined();
    expect(intent.budget).toBeUndefined();
  });

  it("still accepts a plain currency amount", () => {
    const intent = extractKaiTravelIntent("Around $8,000 total", {}, { lastAskedSlot: "budget" });

    expect(intent.budget).toContain("8,000");
  });

  it("still accepts a keyword-marked bare amount", () => {
    const intent = extractKaiTravelIntent("my budget is 5000 dollars", {});

    expect(intent.budget).toBeDefined();
    expect(intent.budget).toContain("5000");
  });

  it("still rejects a bare number with no money evidence", () => {
    const intent = extractKaiTravelIntent("5000", {}, { lastAskedSlot: "budget" });

    expect(intent.budget).toBeUndefined();
  });

  it("accepts a bare '$'-prefixed amount (currency prefix boundary)", () => {
    expect(
      extractKaiTravelIntent("$8,000", {}, { lastAskedSlot: "budget" }).budget,
    ).toContain("8,000");
    expect(
      extractKaiTravelIntent("$5000 total", {}, { lastAskedSlot: "budget" }).budget,
    ).toContain("5000");
  });

  it("picks the currency amount out of a mixed date/guests message", () => {
    const intent = extractKaiTravelIntent(
      "1 Dec 2026 to 14 Dec 2026 for 4 guests, $6,500",
      {},
    );

    expect(intent.budget).toBeDefined();
    expect(intent.budget).toContain("6,500");
    expect(intent.budget).not.toContain("2026");
  });

  it("rejects year-looking amounts with only weak cue words", () => {
    expect(
      extractKaiTravelIntent("about 2026", {}, { lastAskedSlot: "budget" }).budget,
    ).toBeUndefined();
    // "budget 2026" does NOT capture the year; the legacy word signal for
    // the word "budget" still applies (same as master).
    expect(
      extractKaiTravelIntent("budget 2026", {}, { lastAskedSlot: "budget" }).budget,
    ).toBe("budget");
  });

  it("accepts year-looking amounts with strong currency evidence", () => {
    expect(
      extractKaiTravelIntent("my budget is 2026 dollars", {}).budget,
    ).toBeDefined();
    expect(
      extractKaiTravelIntent("around $2026", {}, { lastAskedSlot: "budget" }).budget,
    ).toBeDefined();
  });

  it("keeps the luxury and budget word signals", () => {
    expect(extractKaiTravelIntent("Luxury fit", {}, { lastAskedSlot: "budget" }).budget).toBe("luxury");
    expect(extractKaiTravelIntent("something budget", {}).budget).toBe("budget");
  });
});

describe("extractKaiTravelIntent traveller name", () => {
  it("captures a name when the name slot was asked", () => {
    const intent = extractKaiTravelIntent("Anthony Cargill", {}, { lastAskedSlot: "travellerName" });

    expect(intent.travellerName).toBe("Anthony Cargill");
  });
});

describe("extractKaiTravelIntent yacht selection", () => {
  it("resolves an exact yacht name mention", () => {
    const intent = extractKaiTravelIntent("I'm interested in Samara I", {});

    expect(intent.selectedYachtSlug).toBe("samara-i");
  });
});
