/**
 * Demo data for the booking CMS, for local development only.
 *
 *   npx tsx --env-file=.env.local scripts/seed-rails-demo.ts
 *
 * Creates one operator (Reef Runner Charters) with two trips and a fortnight of
 * bookings made through the real engine, so the calendar, manifests and booking
 * page all have something true to show. Refuses to touch anything but a local
 * database.
 *
 * Test operator sign-in (local only, never a real account):
 *   email:    demo-operator@bluepass.test
 *   password: reef-runner-demo
 */
import { prisma } from "@/lib/db/prisma";
import { addDays, localDateInZone, scheduledDepartures } from "@/lib/services/operators/listing-availability";
import { hashPassword } from "@/lib/services/auth/password";
import { confirmPayment, createOperatorBooking, reserveSeats } from "@/lib/services/rails/bookings";
import type { RailsPayments } from "@/lib/services/rails/payments";

const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error(`Refusing to seed demo data into a non-local database (${host}).`);
}

const EMAIL = "demo-operator@bluepass.test";
const PASSWORD = "reef-runner-demo";
const TZ = "Australia/Brisbane";

/** Records nothing and moves no money: the seed confirms payments as if Stripe had. */
const noPayments: RailsPayments = {
  async createCheckout() { throw new Error("unused"); },
  async expireCheckout() {},
  async retrieveCheckout() { return { bookingId: null, paid: false, paymentIntentId: null, amountTotal: null, currency: null }; },
  async refund() { return { id: "re_demo" }; },
  async chargeIdFor() { return null; },
  async transfer() { return { id: "tr_demo" }; },
};

const GUESTS = [
  ["Mia Torres", "+61 411 204 118"], ["James Whitfield", "+61 422 918 330"], ["Aiko Tanaka", "+81 90 1234 5678"],
  ["Lena Fischer", "+49 151 2345 6789"], ["Sam Okafor", "+61 433 120 774"], ["Priya Raman", "+61 400 551 902"],
  ["Tom Gallagher", "+353 87 123 4567"], ["Chloé Martin", "+33 6 12 34 56 78"], ["Noah Williams", "+1 415 555 0142"],
  ["Hana Kim", "+82 10 2345 6789"], ["Oliver Brooks", "+61 412 777 300"], ["Ruby Nguyen", "+61 455 019 862"],
];

async function main() {
  const existing = await prisma.bluePassAccount.findUnique({ where: { email: EMAIL }, include: { operatorProfile: true } });
  if (existing?.operatorProfile) {
    const ids = (await prisma.operatorListing.findMany({ where: { operatorProfileId: existing.operatorProfile.id }, select: { id: true } })).map((l) => l.id);
    await prisma.listingBookingEvent.deleteMany({ where: { booking: { listingId: { in: ids } } } });
    await prisma.listingBooking.deleteMany({ where: { listingId: { in: ids } } });
    await prisma.listingSeatHold.deleteMany({ where: { listingId: { in: ids } } });
    await prisma.operatorListing.deleteMany({ where: { id: { in: ids } } });
    await prisma.operatorProfile.delete({ where: { id: existing.operatorProfile.id } });
  }
  if (existing) await prisma.bluePassAccount.delete({ where: { id: existing.id } });

  const account = await prisma.bluePassAccount.create({
    data: { email: EMAIL, passwordHash: hashPassword(PASSWORD), emailVerifiedAt: new Date(), displayName: "Kate Moreno", roles: ["OPERATOR"] },
  });
  const profile = await prisma.operatorProfile.create({
    data: { accountId: account.id, status: "APPROVED", companyName: "Reef Runner Charters", whatsappE164: "+61 400 000 111", country: "AU" },
  });

  const reef = await prisma.operatorListing.create({
    data: {
      operatorProfileId: profile.id,
      title: "Outer Reef Snorkel Day",
      slug: "outer-reef-snorkel-day",
      category: "Dive",
      region: "Great Barrier Reef",
      description:
        "A full day on the outer edge of the reef with two snorkel sites chosen on the morning for the clearest water. Small group, no rush, and a marine biologist on board to tell you what you are looking at.\n\nLunch, reef tax, stinger suits and all snorkel gear are included. Introductory dives are available on board.",
      heroImageUrl: "/great-barrier-4.jpg",
      maxGuests: 14,
      status: "LIVE",
      publishedAt: new Date(),
      priceFrom: 189,
      durationMinutes: 8 * 60,
      meetingPoint: "Marina Pier B, Cairns. Look for the blue flag.",
      confirmationNote: "Check in 30 minutes before departure. Bring a towel, a hat and reef-safe sunscreen. Lunch is on board.",
    },
  });
  await prisma.listingSchedule.create({
    data: { listingId: reef.id, weekdays: [2, 4, 6], departureTimes: ["08:00"], capacityPerDeparture: 14, minGuests: 2, cutoffHours: 18, timezone: TZ },
  });
  const adult = await prisma.listingRate.create({ data: { listingId: reef.id, label: "Adult", amountCents: 18900, isDefault: true } });
  const child = await prisma.listingRate.create({ data: { listingId: reef.id, label: "Child", amountCents: 9900, minAge: 4, maxAge: 14 } });

  const sunset = await prisma.operatorListing.create({
    data: {
      operatorProfileId: profile.id,
      title: "Sunset Sail, Trinity Inlet",
      slug: "sunset-sail-trinity-inlet",
      category: "Sail & Yacht",
      region: "Cairns",
      description: "Two hours under sail as the light goes gold over the inlet. Drinks and local cheese on deck.",
      heroImageUrl: "/whitsundays-2.jpg",
      maxGuests: 20,
      status: "LIVE",
      publishedAt: new Date(),
      priceFrom: 79,
      durationMinutes: 120,
      meetingPoint: "Marlin Jetty, berth 7",
    },
  });
  await prisma.listingSchedule.create({
    data: { listingId: sunset.id, weekdays: [], departureTimes: ["17:00"], capacityPerDeparture: 20, cutoffHours: 3, timezone: TZ },
  });
  const sail = await prisma.listingRate.create({ data: { listingId: sunset.id, label: "Adult", amountCents: 7900, isDefault: true } });
  await prisma.listingRate.create({ data: { listingId: sunset.id, label: "Private charter", amountCents: 120000, perGuest: false } });

  const draft = await prisma.operatorListing.create({
    data: {
      operatorProfileId: profile.id, title: "Fitzroy Island Day Trip", slug: "fitzroy-island-day-trip", category: "Expedition",
      region: "Cairns", description: "Ferry, rainforest walk and a beach afternoon on Fitzroy Island.", status: "DRAFT", heroImageUrl: "/great-barrier-3.jpg",
    },
  });
  void draft;

  const today = localDateInZone(new Date(), TZ);
  await prisma.listingBlackout.create({
    data: { listingId: reef.id, startDate: new Date(`${addDays(today, 24)}T00:00:00Z`), endDate: new Date(`${addDays(today, 27)}T00:00:00Z`), reason: "Annual survey on the slipway" },
  });

  // Bookings: the engine is used as-is, with "now" set a week back so departures inside
  // the cutoff can still be sold the way they would have been at the time.
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  let g = 0;
  const lead = () => {
    const [name, phone] = GUESTS[g++ % GUESTS.length];
    return { name, phone, email: `${name.split(" ")[0].toLowerCase()}@example.test` };
  };

  for (let i = -1; i <= 13; i += 1) {
    const date = addDays(today, i);
    for (const [listing, rate, schedule] of [[reef, adult, "reef"], [sunset, sail, "sunset"]] as const) {
      const schedules = await prisma.listingSchedule.findMany({ where: { listingId: listing.id } });
      for (const d of scheduledDepartures(schedules, date)) {
        const parties = schedule === "reef" ? (i < 6 ? 3 : 1) : i % 3 === 0 ? 2 : 0;
        for (let p = 0; p < parties; p += 1) {
          const who = lead();
          const quantities: Record<string, number> = { [rate.id]: 2 };
          if (schedule === "reef" && p === 1) quantities[child.id] = 1;
          const r = await reserveSeats({
            listingId: listing.id, departsAt: d.departsAt, quantities, lead: who, source: p === 2 ? "KAI" : "ONLINE",
            now: weekAgo, notes: p === 1 ? "Celebrating an anniversary" : null, whatsappOptIn: p !== 1,
          });
          if (!r.ok) continue;
          await confirmPayment({ bookingId: r.booking.id, sessionId: `cs_demo_${r.booking.id}`, paymentIntentId: null, amountTotal: r.booking.totalCents, currency: "aud", now: weekAgo }, noPayments);
          if (i < 0) await prisma.listingBooking.update({ where: { id: r.booking.id }, data: { checkedInAt: d.departsAt } });
        }
        if (schedule === "reef" && i >= 0 && i < 6) {
          const who = lead();
          await createOperatorBooking({
            operatorProfileId: profile.id, listingId: listing.id, departsAt: d.departsAt, quantities: { [adult.id]: 3 },
            lead: { name: who.name, phone: who.phone }, paid: i % 2 === 0, sendConfirmation: false, actorEmail: EMAIL, now: weekAgo,
            notes: "Phoned in, staying at the Hilton",
          });
        }
      }
    }
  }

  const count = await prisma.listingBooking.count({ where: { operatorProfileId: profile.id } });
  console.log(`Seeded Reef Runner Charters: 3 listings, ${count} bookings. Sign in as ${EMAIL}.`);
}

main().finally(() => prisma.$disconnect());
