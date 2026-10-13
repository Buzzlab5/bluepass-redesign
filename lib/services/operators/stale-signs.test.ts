import { describe, expect, it } from "vitest";
import { pageStaleSigns, staleSigns } from "@/lib/services/operators/stale-signs";
import type { PreparedTrip } from "@/lib/services/operators/prepared-pages";

const today = new Date(Date.UTC(2026, 9, 12, 9)); // 12 Oct 2026
const trip = (over: Partial<PreparedTrip>): PreparedTrip => ({ title: "Trip", kind: "tour", summary: "x", sourceUrl: "https://x.test", ...over });

/** The texts are the operators' own, as the researchers recorded them. */
describe("staleSigns", () => {
  it("flags departure dates that have all gone", () => {
    // Whale Swim Queensland's Whale Week
    expect(staleSigns(trip({ season: "Aug 24th-30th and Sep 21st-27th (2026)" }), today)).toEqual([
      'Dates have passed: "Aug 24th-30th and Sep 21st-27th (2026)"',
    ]);
  });

  it("flags a list where some listed departures have gone", () => {
    expect(staleSigns(trip({ season: "Departures listed 7 Oct and 15 Dec 2026" }), today)).toEqual([
      'Some dates have passed: "Departures listed 7 Oct and 15 Dec 2026"',
    ]);
  });

  it("leaves a season that is still running, and future departures, alone", () => {
    expect(staleSigns(trip({ season: "July to October 2026" }), today)).toEqual([]);
    expect(staleSigns(trip({ season: "Departures listed 17 Oct, 17 Nov and 24 Nov 2026, then 25 Apr, 12 Oct and 24 Nov 2027" }), today)).toEqual([]);
    expect(staleSigns(trip({ season: "2027: June 6 - 12 (Hike & Kayak), June 13 - 20 (Base Camp)" }), today)).toEqual([]);
    expect(staleSigns(trip({ title: "Great White New Year Expedition (4 Nights/5 Days) 2027", season: "One departure listed: 31 Dec 2026 to 4 Jan 2027" }), today)).toEqual([]);
    expect(staleSigns(trip({ prices: [{ label: "Adult Swimming", amount: 300, currency: "AUD", note: "2026/27 rate, valid until 30 April 2027" }] }), today)).toEqual([]);
  });

  it("flags a price list for a year that is over", () => {
    expect(staleSigns(trip({ prices: [{ label: "Adult", amount: 210, currency: "AUD", note: "Valid 2025" }] }), today)).toEqual(['Mentions 2025: "Adult, Valid 2025"']);
  });

  it("flags an offer that has ended", () => {
    expect(pageStaleSigns([{ text: "Spring special", validUntil: "2026-09-30" }], today)).toEqual(['Offer ended 2026-09-30: "Spring special"']);
    expect(pageStaleSigns([{ text: "Gift vouchers", validUntil: null }], today)).toEqual([]);
  });
});
