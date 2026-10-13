import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { addFareHarborTrip, recordHandoff } from "@/lib/services/channels/fareharbor/connect";
import { detectColumns, importReport, parseCsv, parseLocalDateTime, parseMoney, previewReport } from "@/lib/services/channels/fareharbor/report";
import { zonedTimeToUtc } from "@/lib/services/operators/listing-availability";
import { resetRailsTables, seedOperator } from "@/lib/services/rails/test-fixtures";

/**
 * FareHarbor's affiliate report is the only way its bookings reach Bluepass. The
 * reader has to cope with a layout FareHarbor does not publish, refuse what it cannot
 * read rather than guess, and import the same report twice without doubling anything.
 */

const TAGGED = "https://fareharbor.com/embeds/book/reefrunner/items/412233/?asn=bluepass";

beforeAll(() => { process.env.FAREHARBOR_AFFILIATE_SHORTNAME = "bluepass"; });
beforeEach(async () => { await resetRailsTables(); });

describe("reading the report", () => {
  it("reads quoted CSV with commas and doubled quotes", () => {
    expect(parseCsv('a,b\n"1,5","say ""hi"""\r\n\n2,3')).toEqual([["a", "b"], ["1,5", 'say "hi"'], ["2", "3"]]);
  });

  it("finds the columns by what their headers say", () => {
    const c = detectColumns(["Booking #", "Created", "Item", "Start", "Customers", "Contact", "Total", "Commission", "Voucher #", "Status"]);
    expect(c).toMatchObject({ booking: 0, item: 2, start: 3, guests: 4, name: 5, total: 6, commission: 7, voucher: 8, status: 9 });
  });

  it("reads the date forms a US system writes, month first", () => {
    expect(parseLocalDateTime("2026-10-14 07:30")).toEqual({ date: "2026-10-14", time: "07:30" });
    expect(parseLocalDateTime("10/14/2026 7:30 PM")).toEqual({ date: "2026-10-14", time: "19:30" });
    expect(parseLocalDateTime("Wed, Oct 14, 2026, 12:15 AM")).toEqual({ date: "2026-10-14", time: "00:15" });
    expect(parseLocalDateTime("October 14, 2026 at 9am")).toEqual({ date: "2026-10-14", time: "09:00" });
    expect(parseLocalDateTime("next tuesday")).toBeNull();
  });

  it("reads money and refuses a decimal comma", () => {
    expect(parseMoney("$1,234.50")).toBe(123450);
    expect(parseMoney("USD 90")).toBe(9000);
    expect(parseMoney("1.234,50")).toBeNull();
  });
});

describe("importing it", () => {
  async function setup() {
    const { profile } = await seedOperator();
    const added = await addFareHarborTrip({ operatorProfileId: profile.id, link: TAGGED, title: "Turtle Snorkel", region: "Bridgetown", description: "Swim with green turtles.", timezone: "America/Barbados" });
    const listing = await prisma.operatorListing.findUniqueOrThrow({ where: { id: added.listingId! } });
    const handoff = await recordHandoff(listing, "CREATOR42");
    return { profile, listing, reference: handoff!.reference };
  }

  it("matches rows to hand-offs, explains the rest, and imports only what it matched", async () => {
    const { profile, listing, reference } = await setup();
    const csv = [
      "Booking #,Item,Start,Customers,Contact,Total,Commission,Voucher #,Status",
      `88001,Turtle Snorkel,10/14/2026 9:00 AM,2,Mia Berg,$180.00,$27.00,${reference},Booked`,
      "88002,Turtle Snorkel,10/15/2026 9:00 AM,1,Sam Lee,$90.00,$13.50,BP-ZZZZZZ,Booked",
      `88003,Turtle Snorkel,sometime,1,Ana Ruiz,$90.00,$13.50,${reference},Booked`,
    ].join("\n");

    const preview = await previewReport(csv);
    if (!preview.ok) throw new Error(preview.message);
    expect(preview.rows.map((r) => r.problem)).toEqual([null, expect.stringMatching(/not one of Bluepass's hand-offs/), expect.stringMatching(/could not be read/)]);

    const result = await importReport(csv, "admin@bluepass.test");
    expect(result).toMatchObject({ ok: true, created: 1, updated: 0, skipped: 2 });
    const booking = await prisma.listingBooking.findUniqueOrThrow({ where: { externalReference: "FH-88001" } });
    expect(booking).toMatchObject({
      reference,
      listingId: listing.id,
      operatorProfileId: profile.id,
      channel: "FAREHARBOR",
      status: "CONFIRMED",
      paymentStatus: "PAID_VIA_CHANNEL",
      totalCents: 18000,
      commissionCents: 2700,
      conservationCents: 900,
      guests: 2,
      leadName: "Mia Berg",
      referralCode: "CREATOR42",
    });
    // FareHarbor reports local times; the operator's zone came from their browser when they connected.
    expect(booking.departsAt.toISOString()).toBe(zonedTimeToUtc("2026-10-14", "09:00", "America/Barbados").toISOString());
    expect(booking.timezone).toBe("America/Barbados");
  });

  it("updates on a second import instead of doubling, and follows a cancellation", async () => {
    const { reference } = await setup();
    const header = "Booking #,Start,Customers,Total,Commission,Voucher #,Status";
    await importReport(`${header}\n88001,2026-10-14 09:00,2,180,27,${reference},Booked`, "admin");
    const again = await importReport(`${header}\n88001,2026-10-14 09:00,2,180,27,${reference},Cancelled`, "admin");
    expect(again).toMatchObject({ ok: true, created: 0, updated: 1 });
    expect(await prisma.listingBooking.count({ where: { channel: "FAREHARBOR" } })).toBe(1);
    expect(await prisma.listingBooking.findFirstOrThrow({ where: { externalReference: "FH-88001" } })).toMatchObject({ status: "CANCELLED", conservationCents: 0, paymentStatus: "REFUNDED" });
  });

  it("refuses a report it cannot map, naming the columns it found", async () => {
    const preview = await previewReport("Name,Date\nMia,2026-10-14");
    expect(preview).toMatchObject({ ok: false });
    if (!preview.ok) expect(preview.message).toMatch(/Columns found: Name, Date/);
  });
});
