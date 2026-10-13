import { describe, expect, it } from "vitest";
import type { RezdyProduct, RezdySession } from "@/lib/services/channels/rezdy/api";
import {
  buildBookingRequest,
  checkAnswers,
  countryOfPhone,
  dayFromSessions,
  monthFromSessions,
  parseRezdyAlias,
  plainText,
  priceRezdyParty,
  productIssue,
  productToListing,
  questionsFor,
  ratesFor,
  statusOfOrder,
} from "@/lib/services/channels/rezdy/map";
import { reefRunnerOnRezdy } from "@/lib/services/channels/rezdy/sim";
import availability from "@/lib/services/channels/rezdy/__fixtures__/staging-availability-PWQF1Y.json";
import marketplace from "@/lib/services/channels/rezdy/__fixtures__/staging-marketplace-sample.json";
import pickups from "@/lib/services/channels/rezdy/__fixtures__/staging-pickups-PWQF1Y.json";
import productResponse from "@/lib/services/channels/rezdy/__fixtures__/staging-product-PWQF1Y.json";

/**
 * The mapping between Rezdy's shapes and Bluepass's, against real responses from
 * Rezdy's staging demo account (the dive product PWQF1Y and a sample of the
 * marketplace), so the code is tested on what Rezdy actually sends.
 */

const dive = (productResponse as { product: RezdyProduct }).product;
const sessions = (availability as { sessions: RezdySession[] }).sessions;

describe("accounts and products", () => {
  it("reads the alias from whatever an operator pastes", () => {
    expect(parseRezdyAlias("reefrunner")).toBe("reefrunner");
    expect(parseRezdyAlias("ReefRunner.rezdy.com")).toBe("reefrunner");
    expect(parseRezdyAlias("https://reefrunner.rezdy.com/185372/outer-reef")).toBe("reefrunner");
    expect(parseRezdyAlias("https://reefrunner-booking-form.rezdy.com/view/PWQF1Y")).toBe("reefrunner");
    expect(parseRezdyAlias("https://reefrunner.com.au")).toBeNull();
    expect(parseRezdyAlias("")).toBeNull();
  });

  it("turns Rezdy's HTML into paragraphs", () => {
    expect(plainText("<p>One &amp; two</p><p>Three<br>four</p><ul><li>a</li><li>b</li></ul>")).toBe("One & two\n\nThree\nfour\n\n· a\n· b");
  });

  it("fills a listing from the staging dive product", () => {
    const listing = productToListing(dive);
    expect(listing.title).toBe("Double dive with sharks");
    expect(listing.region).toBe("Byron Bay");
    expect(listing.meetingPoint).toBe("Julien rocks, Byron Bay");
    expect(listing.durationMinutes).toBe(180);
    expect(listing.heroImageUrl).toMatch(/_lg\.jpg$/);
    expect(listing.priceFrom).toBe(200);
    expect(listing.currency).toBe("AUD");
  });

  it("sells automated-payment and full-payment-to-agent rates, and says why it will not sell the rest", () => {
    expect(productIssue(dive)).toBeNull(); // FULL_AGENT
    const products = (marketplace as { products: RezdyProduct[] }).products;
    expect(productIssue(products.find((p) => p.productCode === "PNF01G")!)).toBeNull(); // PAYOUTS
    expect(productIssue({ ...dive, agentPaymentType: "DOWNPAYMENT" })).toMatch(/deposit/);
    expect(productIssue({ ...dive, agentPaymentType: "FULL_SUPPLIER" })).toMatch(/pay you directly/);
    expect(productIssue({ ...dive, isApiBookingSupported: false })).toMatch(/does not let agents book/);
    expect(productIssue({ ...dive, bookingMode: "NO_DATE" })).toMatch(/open-dated/);
  });
});

describe("sessions and prices", () => {
  it("uses each session's own prices, only for this product", () => {
    const [allDay, afternoon] = sessions;
    expect(ratesFor(dive, allDay).find((r) => r.id === "Adult")?.amountCents).toBe(19900);
    expect(ratesFor(dive, afternoon).find((r) => r.id === "Adult")?.amountCents).toBe(14900);
    const shared = { ...afternoon, priceOptions: [...afternoon.priceOptions!, { label: "Adult", price: 1, productCode: "POTHER" }] };
    expect(ratesFor(dive, shared).filter((r) => r.id === "Adult")).toHaveLength(1);
    expect(ratesFor(dive, null).find((r) => r.id === "Adult")?.amountCents).toBe(25000);
  });

  it("builds a month and a day, closing what is inside the minimum notice", () => {
    const now = new Date("2026-10-31T10:00:00Z");
    const days = monthFromSessions({ product: dive, sessions, month: "2026-11", today: "2026-10-31", now });
    const first = days.find((d) => d.date === "2026-11-01")!;
    // The product wants 24 hours' notice, and both of 1 November's sessions start within 24 hours of now.
    expect(first.status).toBe("closed");
    const earlier = monthFromSessions({ product: dive, sessions, month: "2026-11", today: "2026-10-20", now: new Date("2026-10-20T00:00:00Z") });
    expect(earlier.find((d) => d.date === "2026-11-01")).toMatchObject({ status: "available", fromCents: 14900, seatsLeft: 2 });
    const day = dayFromSessions(dive, sessions, "2026-11-01", new Date("2026-10-20T00:00:00Z"));
    expect(day.map((d) => [d.allDay, d.localTime, d.seatsLeft])).toEqual([[true, "", 2], [false, "14:00", 1]]);
  });

  it("prices a party the way Rezdy will, counting a family ticket as four seats", () => {
    const sim = reefRunnerOnRezdy("2026-11-01");
    const reef = sim.products[0];
    const session: RezdySession = { productCode: reef.productCode, startTime: "2026-11-01T21:30:00Z", startTimeLocal: "2026-11-02 07:30:00", seatsAvailable: 24, priceOptions: reef.priceOptions };
    const priced = priceRezdyParty(reef, session, { Adult: 2, "Family of 4": 1 });
    expect(priced).toMatchObject({ ok: true, seats: 6, totalCents: 2 * 22900 + 64000 });
    expect(priceRezdyParty(reef, session, { Snorkeller: 1 })).toMatchObject({ ok: false });
    expect(priceRezdyParty(reef, session, {})).toMatchObject({ ok: false });
  });
});

describe("booking questions", () => {
  it("asks only what the operator made required, and answers the lead's own details itself", () => {
    const sim = reefRunnerOnRezdy("2026-11-01");
    const q = questionsFor(sim.products[0], sim.products[0].pickups!);
    expect(q.booking).toEqual([]); // name, email, mobile and country all come from the lead guest
    expect(q.phoneRequired).toBe(true);
    expect(q.pickups.map((p) => p.name)).toEqual(["Cairns Esplanade hotels", "Palm Cove"]);

    const diveQ = questionsFor({ ...dive, bookingFields: [...dive.bookingFields!, { label: "Certification level", requiredPerParticipant: true, fieldType: "List", listOptions: "Open Water\r\nAdvanced" }] }, []);
    expect(diveQ.participant.map((x) => [x.label, x.options])).toEqual([["Certification level", ["Open Water", "Advanced"]]]);
    expect(checkAnswers(diveQ, { fields: {}, participants: [{ "Certification level": "Open Water" }], pickup: null }, 2)).toMatch(/guest 2/);
    expect(checkAnswers(diveQ, { fields: {}, participants: [{ "Certification level": "Open Water" }, { "Certification level": "Expert" }], pickup: null }, 2)).toMatch(/from the list/);
    expect(checkAnswers(diveQ, { fields: {}, participants: [{ "Certification level": "Open Water" }, { "Certification level": "Advanced" }], pickup: null }, 2)).toBeNull();
  });

  it("reads the country Rezdy wants from an international number", () => {
    expect(countryOfPhone("+61412345678")).toBe("AU");
    expect(countryOfPhone("+12465551234")).toBe("BB");
    expect(countryOfPhone(null)).toBeNull();
  });
});

describe("the order sent to Rezdy", () => {
  const sim = reefRunnerOnRezdy("2026-11-01");
  const reef = sim.products[0];
  const session: RezdySession = { productCode: reef.productCode, startTime: "2026-11-01T21:30:00Z", startTimeLocal: "2026-11-02 07:30:00", seatsAvailable: 24 };
  const base = {
    product: reef,
    session,
    quantities: [{ label: "Adult", quantity: 2 }],
    lead: { name: "Mia van der Berg", email: "mia@example.test", phone: "+61412345678" },
    notes: "One vegetarian lunch",
    answers: { fields: {}, participants: [], pickup: "Palm Cove" },
    reference: "BP-7K3QXD",
  };

  it("fills the operator's questions from the lead guest and keeps Rezdy's own emails off", () => {
    const request = buildBookingRequest({ ...base, payment: { kind: "card", token: "tok_visa" } });
    expect(request.customer).toEqual({ firstName: "Mia van der", lastName: "Berg", email: "mia@example.test", phone: "+61412345678" });
    expect(request.fields).toEqual(expect.arrayContaining([
      { label: "Mobile", value: "+61412345678" },
      { label: "Country", value: "AU" },
      { label: "Special Requirements", value: "One vegetarian lunch" },
    ]));
    expect(request.items[0]).toMatchObject({ productCode: "PRR001", startTimeLocal: "2026-11-02 07:30:00", quantities: [{ optionLabel: "Adult", value: 2 }], pickupLocation: { locationName: "Palm Cove" } });
    expect(request).toMatchObject({ resellerReference: "BP-7K3QXD", sendNotifications: false, creditCard: { cardToken: "tok_visa" } });
    expect(request.payments).toBeUndefined();
  });

  it("records Bluepass's payment as a card payment to the agent, never as cash", () => {
    const request = buildBookingRequest({ ...base, payment: { kind: "paid", amountCents: 46500, currency: "AUD", label: "Paid to Bluepass by card", at: new Date("2026-10-01T00:00:00Z") } });
    expect(request.payments).toEqual([{ type: "CREDITCARD", amount: 465, currency: "AUD", date: "2026-10-01T00:00:00.000Z", label: "Paid to Bluepass by card", recipient: "RESELLER" }]);
    expect(buildBookingRequest({ ...base, payment: { kind: "hold" } }).status).toBe("PROCESSING");
  });

  it("maps Rezdy's order statuses to Bluepass's", () => {
    expect(statusOfOrder("CONFIRMED")).toBe("CONFIRMED");
    expect(statusOfOrder("PENDING_SUPPLIER")).toBe("REQUESTED");
    expect(statusOfOrder("PROCESSING")).toBe("PENDING_PAYMENT");
    expect(statusOfOrder("ABANDONED_CART")).toBe("CANCELLED");
  });
});

it("reads pickups in the staging shape", () => {
  const list = (pickups as { pickupLocations: { locationName: string }[] }).pickupLocations;
  expect(questionsFor(dive, list as never).pickups.map((p) => p.name)).toEqual(["Divers hotel", "Seaside hostel"]);
});
