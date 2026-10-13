import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { KaiNativeError, type NativeTrip } from "@/lib/services/kai-core/native-admin";
import { EMPTY_TRIP_EDITOR, type TripEditorValues } from "./native-trip-editor";
import {
  deleteOperatorTrip,
  listingFieldsForTrip,
  publishOperatorTrip,
  saveOperatorTrip,
  unpublishOperatorTrip,
  type Deps,
} from "./native-trips";

/**
 * Real rows in the shared dev database, with Kai replaced by an in-memory fake so nothing is created
 * or sold there. Everything made here hangs off one BluePassAccount, deleted at the end (which
 * cascades to the profile and its listings).
 */
const EMAIL = `native-trips-test+${randomUUID()}@ops.bluepass.co`;

const values: TripEditorValues = {
  ...EMPTY_TRIP_EDITOR,
  title: `Sunset catamaran ${randomUUID().slice(0, 8)}`,
  category: "Sail & Yacht",
  region: "Barbados West Coast",
  description: "Two hours on the water.",
  durationHours: "2",
  photoUrls: ["https://example.com/a.jpg"],
  tickets: [{ label: "Adult", price: "95", kind: "TICKET" }],
  schedules: [{ days: [1, 3], time: "16:00", seats: "12", validFrom: "", validUntil: "" }],
};

function fakeKai() {
  const trips = new Map<string, NativeTrip>();
  const calls = { ensure: [] as { goLive?: boolean }[], bookedTrips: new Set<string>() };

  const build = (id: string, input: Parameters<Deps["createTrip"]>[1], status: "DRAFT" | "PUBLISHED"): NativeTrip => {
    const tickets = input.tickets.map((t, index) => ({ sortOrder: index, active: true, ...t }));
    const paid = tickets.filter((t) => t.kind === "TICKET" && t.priceCents > 0).map((t) => t.priceCents);
    return {
      ...input,
      id,
      status,
      tickets,
      lowestTicketCents: paid.length ? Math.min(...paid) : null,
      updatedAt: new Date().toISOString(),
    } as NativeTrip;
  };

  const deps: Deps = {
    ensureTenant: vi.fn(async (input) => {
      calls.ensure.push({ goLive: input.goLive });
      return { slug: `fake-${input.externalOperatorId}`, name: input.name, enabledFeatures: [], created: true };
    }),
    createTrip: vi.fn(async (_slug, input) => {
      const trip = build(`trip_${randomUUID()}`, input, "DRAFT");
      trips.set(trip.id, trip);
      return trip;
    }),
    updateTrip: vi.fn(async (_slug, id, input) => {
      const trip = build(id, input, trips.get(id)?.status ?? "DRAFT");
      trips.set(id, trip);
      return trip;
    }),
    getTrip: vi.fn(async (_slug, id) => trips.get(id)!),
    listTrips: vi.fn(async () => [...trips.values()]),
    setPublished: vi.fn(async (_slug, id, published) => {
      const trip = trips.get(id)!;
      if (published && trip.lowestTicketCents === null) throw new KaiNativeError("Add at least one ticket with a price.", "CANNOT_PUBLISH", 400);
      const next = { ...trip, status: published ? ("PUBLISHED" as const) : ("DRAFT" as const) };
      trips.set(id, next);
      return next;
    }),
    deleteTrip: vi.fn(async (_slug, id) => {
      if (calls.bookedTrips.has(id)) throw new KaiNativeError("This trip has bookings, so it cannot be deleted.", "HAS_BOOKINGS", 409);
      trips.delete(id);
    }),
  };
  return { deps, calls };
}

async function operator(overrides: { status?: "APPROVED" | "PENDING_REVIEW"; rezdySupplierId?: string } = {}) {
  const account = await prisma.bluePassAccount.create({
    data: { email: EMAIL.replace("+", `+${randomUUID().slice(0, 6)}`), passwordHash: "unusable", roles: ["OPERATOR"] },
  });
  const profile = await prisma.operatorProfile.create({
    data: {
      accountId: account.id,
      status: overrides.status ?? "APPROVED",
      companyName: "Native Trips Test Charters",
      rezdySupplierId: overrides.rezdySupplierId ?? null,
    },
    select: { id: true, status: true, companyName: true, whatsappE164: true, kaiTenantSlug: true, rezdySupplierId: true },
  });
  return profile;
}

afterAll(async () => {
  await prisma.bluePassAccount.deleteMany({ where: { email: { startsWith: "native-trips-test+" } } });
});

describe("listingFieldsForTrip", () => {
  it("shows the cheapest ticket, the biggest departure and the cover photo", () => {
    const { deps } = fakeKai();
    void deps;
    const trip = {
      title: "Sunset catamaran",
      description: "",
      photoUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      currency: "USD",
      lowestTicketCents: 4750,
      schedules: [
        { seats: 8, active: true },
        { seats: 20, active: true },
        { seats: 99, active: false },
      ],
    } as unknown as NativeTrip;
    expect(listingFieldsForTrip(trip, { category: "Dive", region: "Barbados" })).toMatchObject({
      priceFrom: 47.5,
      priceSignal: "From USD 47.50",
      maxGuests: 20,
      heroImageUrl: "https://example.com/a.jpg",
      description: "Sunset catamaran",
      currency: "USD",
    });
  });

  it("has no price until a ticket has one", () => {
    const trip = { title: "T", description: "d", photoUrls: [], currency: "USD", lowestTicketCents: null, schedules: [] } as unknown as NativeTrip;
    expect(listingFieldsForTrip(trip, { category: "Dive", region: "Barbados" })).toMatchObject({ priceFrom: null, priceSignal: null, maxGuests: null, heroImageUrl: null });
  });
});

describe("operator trips across Kai and the website listing", () => {
  it("creates the Kai tenant once, saves the trip as a draft, and writes a hidden draft listing", async () => {
    const profile = await operator();
    const { deps, calls } = fakeKai();

    const saved = await saveOperatorTrip(profile, null, values, deps);
    if (!saved.ok) throw new Error(saved.message);

    const stored = await prisma.operatorProfile.findUniqueOrThrow({ where: { id: profile.id }, select: { kaiTenantSlug: true } });
    expect(stored.kaiTenantSlug).toBe(`fake-${profile.id}`);
    expect(calls.ensure).toEqual([{ goLive: undefined }]);

    const listing = await prisma.operatorListing.findUniqueOrThrow({ where: { nativeTripId: saved.trip.id } });
    expect(listing).toMatchObject({ status: "DRAFT", publishedAt: null, bookingPlatform: "NATIVE", priceFrom: 95, currency: "USD", region: "Barbados West Coast" });
  });

  it("refuses to publish until the account is approved", async () => {
    const profile = await operator({ status: "PENDING_REVIEW" });
    const { deps } = fakeKai();
    const saved = await saveOperatorTrip(profile, null, values, deps);
    if (!saved.ok) throw new Error(saved.message);

    const result = await publishOperatorTrip(profile, saved.trip.id, deps);
    expect(result).toMatchObject({ ok: false });
    expect(deps.setPublished).not.toHaveBeenCalled();
  });

  it("publishing puts the trip on sale, turns the operator live and makes the listing LIVE; unpublishing reverses the listing", async () => {
    const profile = await operator();
    const { deps, calls } = fakeKai();
    const saved = await saveOperatorTrip(profile, null, values, deps);
    if (!saved.ok) throw new Error(saved.message);

    const published = await publishOperatorTrip(profile, saved.trip.id, deps);
    if (!published.ok) throw new Error(published.message);
    expect(calls.ensure.some((call) => call.goLive === true)).toBe(true);
    let listing = await prisma.operatorListing.findUniqueOrThrow({ where: { nativeTripId: saved.trip.id } });
    expect(listing.status).toBe("LIVE");
    expect(listing.publishedAt).not.toBeNull();

    const withTenant = { ...profile, kaiTenantSlug: `fake-${profile.id}` };
    const unpublished = await unpublishOperatorTrip(withTenant, saved.trip.id, deps);
    expect(unpublished.ok).toBe(true);
    listing = await prisma.operatorListing.findUniqueOrThrow({ where: { nativeTripId: saved.trip.id } });
    expect(listing.status).toBe("DRAFT");
  });

  it("does not publish a trip Kai says is not sellable, and leaves the listing hidden", async () => {
    const profile = await operator();
    const { deps } = fakeKai();
    const saved = await saveOperatorTrip(profile, null, { ...values, tickets: [{ label: "Adult", price: "0", kind: "TICKET" }] }, deps);
    if (!saved.ok) throw new Error(saved.message);

    const result = await publishOperatorTrip(profile, saved.trip.id, deps);
    expect(result).toEqual({ ok: false, message: "Add at least one ticket with a price." });
    const listing = await prisma.operatorListing.findUniqueOrThrow({ where: { nativeTripId: saved.trip.id } });
    expect(listing.status).toBe("DRAFT");
  });

  it("keeps a listing an admin took down archived, and says so", async () => {
    const profile = await operator();
    const { deps } = fakeKai();
    const saved = await saveOperatorTrip(profile, null, values, deps);
    if (!saved.ok) throw new Error(saved.message);
    await prisma.operatorListing.update({ where: { nativeTripId: saved.trip.id }, data: { status: "ARCHIVED", archivedAt: new Date(), archivedBy: "admin", archivedReason: "test" } });

    const withTenant = { ...profile, kaiTenantSlug: `fake-${profile.id}` };
    const published = await publishOperatorTrip(withTenant, saved.trip.id, deps);
    if (!published.ok) throw new Error(published.message);
    expect(published.listingTakenDown).toBe(true);
    const listing = await prisma.operatorListing.findUniqueOrThrow({ where: { nativeTripId: saved.trip.id } });
    expect(listing.status).toBe("ARCHIVED");
  });

  it("edits update the same listing instead of adding a second one", async () => {
    const profile = await operator();
    const { deps } = fakeKai();
    const saved = await saveOperatorTrip(profile, null, values, deps);
    if (!saved.ok) throw new Error(saved.message);
    const withTenant = { ...profile, kaiTenantSlug: `fake-${profile.id}` };

    const edited = await saveOperatorTrip(withTenant, saved.trip.id, { ...values, tickets: [{ label: "Adult", price: "110", kind: "TICKET" }] }, deps);
    expect(edited.ok).toBe(true);
    const listings = await prisma.operatorListing.findMany({ where: { operatorProfileId: profile.id } });
    expect(listings).toHaveLength(1);
    expect(listings[0].priceFrom).toBe(110);
  });

  it("deletes the listing with an unbooked trip but keeps both when Kai refuses", async () => {
    const profile = await operator();
    const { deps, calls } = fakeKai();
    const a = await saveOperatorTrip(profile, null, values, deps);
    const b = await saveOperatorTrip({ ...profile, kaiTenantSlug: `fake-${profile.id}` }, null, { ...values, title: `${values.title} B` }, deps);
    if (!a.ok || !b.ok) throw new Error("setup failed");
    const withTenant = { ...profile, kaiTenantSlug: `fake-${profile.id}` };

    expect((await deleteOperatorTrip(withTenant, a.trip.id, deps)).ok).toBe(true);
    expect(await prisma.operatorListing.findUnique({ where: { nativeTripId: a.trip.id } })).toBeNull();

    calls.bookedTrips.add(b.trip.id);
    const refused = await deleteOperatorTrip(withTenant, b.trip.id, deps);
    expect(refused).toMatchObject({ ok: false });
    expect(await prisma.operatorListing.findUnique({ where: { nativeTripId: b.trip.id } })).not.toBeNull();
  });

  it("leaves trips to the Rezdy sync for a Rezdy operator", async () => {
    const profile = await operator({ rezdySupplierId: `rezdy-${randomUUID()}` });
    const { deps } = fakeKai();
    expect(await saveOperatorTrip(profile, null, values, deps)).toMatchObject({ ok: false });
    expect(deps.createTrip).not.toHaveBeenCalled();
  });
});
