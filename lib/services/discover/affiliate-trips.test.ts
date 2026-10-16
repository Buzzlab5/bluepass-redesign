import { describe, expect, it } from "vitest";
import type { OperatorListing } from "@prisma/client";
import { guideTripUrl, parseAffiliateBookingUrl } from "./affiliate-trips";
import { listingToTrip } from "./operator-listings-as-trips";

describe("parseAffiliateBookingUrl", () => {
  it("accepts a FareHarbor link exactly as pasted", () => {
    const link = "https://fareharbor.com/embeds/book/reefmagic/items/12345/?full-items=yes&flow=no&asn=bluepass";
    expect(parseAffiliateBookingUrl("FAREHARBOR", `  ${link}  `)).toEqual({ ok: true, url: link });
  });

  it("accepts a Rezdy booking link on any rezdy.com subdomain", () => {
    expect(parseAffiliateBookingUrl("REZDY", "https://bluepass.rezdy.com/123456/reef-day")).toMatchObject({ ok: true });
  });

  it("refuses links that are not on the chosen platform, so a Book now button never goes somewhere unexpected", () => {
    expect(parseAffiliateBookingUrl("FAREHARBOR", "https://reefmagic.com.au/book")).toMatchObject({ ok: false });
    expect(parseAffiliateBookingUrl("FAREHARBOR", "https://bluepass.rezdy.com/1/x")).toMatchObject({ ok: false });
    expect(parseAffiliateBookingUrl("REZDY", "https://fareharbor.com/embeds/book/x/")).toMatchObject({ ok: false });
    // A look-alike host must not pass as the real one.
    expect(parseAffiliateBookingUrl("FAREHARBOR", "https://fareharbor.com.evil.example/book")).toMatchObject({ ok: false });
  });

  it("refuses plain http and anything that is not a link", () => {
    expect(parseAffiliateBookingUrl("FAREHARBOR", "http://fareharbor.com/embeds/book/x/")).toMatchObject({ ok: false });
    expect(parseAffiliateBookingUrl("FAREHARBOR", "fareharbor.com/embeds/book/x/")).toMatchObject({ ok: false });
    expect(parseAffiliateBookingUrl("REZDY", "")).toMatchObject({ ok: false });
  });
});

function listing(overrides: Partial<OperatorListing> = {}) {
  const base: OperatorListing = {
    id: "l1",
    operatorProfileId: "p1",
    title: "Outer Reef Day",
    slug: "outer-reef-day",
    category: "Dive",
    region: "Great Barrier Reef",
    description: "A day on the outer reef.",
    heroImageUrl: null,
    galleryUrls: [],
    maxGuests: null,
    priceSignal: "From AUD 249",
    priceFrom: 249,
    currency: "AUD",
    externalProductId: null,
    bookingUrl: null,
    bookingPlatform: null,
    nativeTripId: null,
    channel: "NATIVE",
    channelData: null,
    channelSyncedAt: null,
    channelIssue: null,
    externalBookingUrl: null,
    durationMinutes: null,
    meetingPoint: null,
    confirmationNote: null,
    busyCalendarId: null,
    status: "LIVE",
    publishedAt: new Date(),
    archivedAt: null,
    archivedBy: null,
    archivedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...base, ...overrides, operatorProfile: { companyName: "Reef Magic" } };
}

describe("listingToTrip", () => {
  it("carries the booking link for a resold trip", () => {
    const trip = listingToTrip(listing({ bookingPlatform: "FAREHARBOR", bookingUrl: "https://fareharbor.com/embeds/book/x/" }));
    expect(trip.booking).toEqual({ platform: "FAREHARBOR", url: "https://fareharbor.com/embeds/book/x/" });
    expect(trip.operator).toBe("Reef Magic");
  });

  it("leaves booking unset for trips Kai handles, so the sheet keeps Request this trip", () => {
    expect(listingToTrip(listing()).booking).toBeUndefined();
    // A platform the sheet cannot open is treated the same way.
    expect(listingToTrip(listing({ bookingPlatform: "BOKUN", bookingUrl: "https://bokun.io/x" })).booking).toBeUndefined();
  });

  it("shows the photos the operator uploaded, in order, and none when there are none", () => {
    expect(listingToTrip(listing()).gallery).toEqual([]);
    const photos = ["https://x.supabase.co/storage/v1/object/public/operator-listings/a/1.jpg", "https://x.supabase.co/storage/v1/object/public/operator-listings/a/2.jpg"];
    expect(listingToTrip(listing({ galleryUrls: photos })).gallery).toEqual(photos);
  });
});

describe("guideTripUrl", () => {
  it("sends a trip with its own schedule and price to its booking page", () => {
    expect(guideTripUrl({ slug: "outer-reef-day", hasOwnSchedule: true }, "https://bluepass.co")).toBe("https://bluepass.co/book/outer-reef-day");
  });

  it("opens the trip sheet on the home page for every other trip", () => {
    expect(guideTripUrl({ slug: "outer-reef-day", hasOwnSchedule: false }, "https://bluepass.co/")).toBe("https://bluepass.co/?trip=outer-reef-day");
  });

  it("encodes the slug", () => {
    expect(guideTripUrl({ slug: "a b", hasOwnSchedule: false }, "https://bluepass.co")).toBe("https://bluepass.co/?trip=a%20b");
  });
});
