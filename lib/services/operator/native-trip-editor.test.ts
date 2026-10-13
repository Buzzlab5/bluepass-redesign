import { describe, expect, it } from "vitest";
import {
  centsToPrice,
  EMPTY_TRIP_EDITOR,
  editorToKaiInput,
  priceToCents,
  tripToEditor,
  type TripEditorValues,
} from "./native-trip-editor";
import type { NativeTrip } from "@/lib/services/kai-core/native-admin";

const filled: TripEditorValues = {
  ...EMPTY_TRIP_EDITOR,
  title: " Sunset catamaran ",
  region: "Barbados West Coast",
  description: "Two hours on the water.",
  durationHours: "2,5",
  photoUrls: ["https://example.com/a.jpg", "  "],
  tickets: [
    { label: "Adult", price: "95", kind: "TICKET" },
    { label: "Child", price: "47,50", kind: "TICKET" },
    { label: "", price: "", kind: "TICKET" },
  ],
  schedules: [{ days: [5, 1], time: "16:00", seats: "12", validFrom: "", validUntil: "" }],
  blackouts: [{ fromDate: "2026-12-25", toDate: "", reason: "Christmas" }],
};

describe("priceToCents", () => {
  it("reads whole and decimal prices, with a comma or a point", () => {
    expect(priceToCents("95")).toBe(9500);
    expect(priceToCents("95.5")).toBe(9550);
    expect(priceToCents(" 47,50 ")).toBe(4750);
    expect(priceToCents("0")).toBe(0);
  });

  it("refuses anything that is not a price", () => {
    for (const bad of ["", "abc", "-3", "1.234", "1e3", "$5"]) expect(priceToCents(bad)).toBeNull();
  });

  it("prints cents back the way they were typed", () => {
    expect(centsToPrice(9500)).toBe("95");
    expect(centsToPrice(4750)).toBe("47.50");
  });
});

describe("editorToKaiInput", () => {
  it("converts a filled form, dropping blank rows and sorting days", () => {
    const result = editorToKaiInput(filled);
    if (!result.ok) throw new Error(result.message);
    expect(result.input).toMatchObject({
      title: "Sunset catamaran",
      durationMinutes: 150,
      photoUrls: ["https://example.com/a.jpg"],
      currency: "USD",
    });
    expect(result.input.tickets.map((ticket) => ticket.priceCents)).toEqual([9500, 4750]);
    expect(result.input.schedules).toEqual([
      { daysOfWeek: [1, 5], localTime: "16:00", seats: 12, validFrom: null, validUntil: null, active: true },
    ]);
    expect(result.input.blackouts).toEqual([{ fromDate: "2026-12-25", toDate: "2026-12-25", reason: "Christmas" }]);
    expect(result.region).toBe("Barbados West Coast");
  });

  it("names the field that cannot be read instead of guessing", () => {
    expect(editorToKaiInput({ ...filled, region: "" })).toMatchObject({ ok: false });
    expect(editorToKaiInput({ ...filled, durationHours: "abc" })).toMatchObject({ ok: false });
    expect(editorToKaiInput({ ...filled, tickets: [{ label: "Adult", price: "free", kind: "TICKET" }] })).toMatchObject({
      ok: false,
      message: expect.stringContaining("Adult"),
    });
    expect(editorToKaiInput({ ...filled, schedules: [{ days: [1], time: "09:00", seats: "", validFrom: "", validUntil: "" }] })).toMatchObject({ ok: false });
  });
});

describe("tripToEditor", () => {
  it("round-trips a saved trip", () => {
    const trip = {
      id: "t1",
      title: "Sunset catamaran",
      description: "Two hours.",
      durationMinutes: 150,
      meetingPoint: "Careenage",
      photoUrls: [],
      currency: "USD",
      timeZone: "America/Barbados",
      status: "DRAFT",
      tickets: [{ label: "Adult", priceCents: 9500, kind: "TICKET", sortOrder: 0, active: true }],
      schedules: [{ daysOfWeek: [1], localTime: "16:00", seats: 12, validFrom: null, validUntil: null, active: true }],
      blackouts: [],
      lowestTicketCents: 9500,
      updatedAt: "2026-10-13T00:00:00.000Z",
    } as NativeTrip;
    const editor = tripToEditor(trip, { category: "Dive", region: "Barbados" });
    expect(editor).toMatchObject({ durationHours: "2.5", category: "Dive", photoUrls: [""] });
    const back = editorToKaiInput(editor);
    if (!back.ok) throw new Error(back.message);
    expect(back.input.durationMinutes).toBe(150);
    expect(back.input.tickets[0].priceCents).toBe(9500);
  });
});
