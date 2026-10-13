import { describe, expect, it } from "vitest";
import { applyTripEdits, fieldText, pageEditsFrom, parseField, TRIP_FIELDS, tripEditsFrom } from "@/lib/services/operators/prepared-edits";
import type { PreparedTrip } from "@/lib/services/operators/prepared-pages";

const website: PreparedTrip = {
  title: "Whale Week Australia", kind: "swim", summary: "A week of whale swims.", sourceUrl: "https://x.test",
  season: "Aug 24th-30th and Sep 21st-27th (2026)",
  prices: [{ label: "Adult", amount: 2500, currency: "AUD" }, { label: "Observer", amount: 900, currency: "AUD", note: "no swimming (on the boat)" }],
  priceFrom: 2500, priceFromLabel: "Adult",
};
const field = (name: string) => TRIP_FIELDS.find((f) => f.name === name)!;
/** The form as it arrives untouched: every field as the trip shows it, the From price empty. */
const untouched = () => Object.fromEntries(TRIP_FIELDS.map((f) => [f.name, f.name === "priceFrom" ? "" : fieldText(f.kind, (website as Record<string, unknown>)[f.name])]));

describe("trip corrections", () => {
  it("stores nothing when nothing was changed", () => {
    expect(tripEditsFrom(website, untouched())).toEqual({ ok: true, edits: {} });
  });

  it("stores only what differs from the website", () => {
    const result = tripEditsFrom(website, { ...untouched(), season: "Aug 23rd-29th (2027)" });
    expect(result).toEqual({ ok: true, edits: { season: "Aug 23rd-29th (2027)" } });
  });

  it("reads prices back exactly as written, notes in brackets included", () => {
    expect(fieldText("prices", website.prices)).toBe("Adult = 2500\nObserver = 900 (no swimming (on the boat))");
    const parsed = parseField(field("prices"), "Adult = $2,600\nObserver = 900 (no swimming (on the boat))", "AUD");
    expect(parsed).toEqual({ ok: true, value: [{ label: "Adult", amount: 2600, currency: "AUD" }, { label: "Observer", amount: 900, currency: "AUD", note: "no swimming (on the boat)" }] });
  });

  it("works the From price out again from corrected prices, unless one is set by hand", () => {
    const edited = applyTripEdits(website, { prices: [{ label: "Adult", amount: 2600, currency: "AUD" }, { label: "Observer", amount: 900, currency: "AUD" }] });
    expect([edited.priceFrom, edited.priceFromLabel]).toEqual([2600, "Adult"]);
    const byHand = applyTripEdits(website, { priceFrom: 2200 });
    expect([byHand.priceFrom, byHand.priceFromLabel]).toEqual([2200, null]);
  });

  it("refuses what cannot be a fact", () => {
    expect(tripEditsFrom(website, { ...untouched(), title: " " })).toEqual({ ok: false, message: "Title cannot be empty." });
    expect(tripEditsFrom(website, { ...untouched(), prices: "Adult two thousand" })).toMatchObject({ ok: false, message: expect.stringContaining("Adult = 120") });
    expect(tripEditsFrom(website, { ...untouched(), summary: "Whales — lots of them." })).toMatchObject({ ok: false, message: expect.stringContaining("em dash") });
  });

  it("keeps contact corrections apart from the rest of the page", () => {
    const page = { slug: "x", name: "X", website: "https://x.test", summary: "S", trips: [], contact: { phone: "+61 4747 7777", email: "a@x.test" } };
    expect(pageEditsFrom(page, { summary: "S", standouts: "", phone: "+61 4 74 727 777", email: "a@x.test", address: "" })).toEqual({ ok: true, edits: { contact: { phone: "+61 4 74 727 777" } } });
  });
});
