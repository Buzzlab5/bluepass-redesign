import { describe, expect, it } from "vitest";
import { bookingRoute } from "@/lib/services/operators/booking-route";
import type { PreparedTrip } from "@/lib/services/operators/prepared-pages";

const page = { website: "https://reef.test", contact: { email: "hello@reef.test", phone: "07 4000 0000" } };
const trip = (more: Partial<PreparedTrip>): PreparedTrip => ({ title: "Reef day", kind: "snorkel", summary: "A day on the reef.", sourceUrl: "https://reef.test/day", ...more });

describe("how a prepared trip books", () => {
  it("opens the trip on the operator's booking page when the website links to it", () => {
    expect(bookingRoute(trip({ bookingLinks: ["https://reefco.rezdy.com/123456/reef-day"] }), page)).toEqual({ kind: "online", url: "https://reefco.rezdy.com/123456/reef-day" });
  });

  it("is booked by asking when the website gives no booking link, as charters and school trips are", () => {
    expect(bookingRoute(trip({ kind: "charter", sourceUrl: "https://reef.test/charters" }), page)).toEqual({
      kind: "enquire", url: "https://reef.test/charters", email: "hello@reef.test", phone: "07 4000 0000", whatsapp: null,
    });
  });

  it("offers WhatsApp when the operator publishes a WhatsApp number", () => {
    const withChat = { ...page, contact: { ...page.contact, whatsapp: "https://wa.me/12465551234?text=Hi" } };
    expect(bookingRoute(trip({}), withChat)).toMatchObject({ kind: "enquire", whatsapp: "https://wa.me/12465551234" });
    expect(bookingRoute(trip({}), { ...page, contact: { ...page.contact, whatsapp: "+1 (246) 555-1234" } })).toMatchObject({ whatsapp: "https://wa.me/12465551234" });
    expect(bookingRoute(trip({}), { ...page, contact: { ...page.contact, whatsapp: "call us" } })).toMatchObject({ whatsapp: null });
  });

  it("never sends a traveller to a link that is not a web address", () => {
    expect(bookingRoute(trip({ bookingLinks: ["javascript:alert(1)"], sourceUrl: "nonsense" }), page)).toMatchObject({ kind: "enquire", url: "https://reef.test/" });
  });
});
