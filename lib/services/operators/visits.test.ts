import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { barbadosVisits, confirmEmailInPerson } from "@/lib/services/operators/visits";

/**
 * Going round in person: the visitor takes a business email face to face so the claim
 * link can be sent while they are there, and the visit list shows who still needs one.
 */

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "OperatorOutreachEvent", "OperatorLead", "PreparedOperatorPage" CASCADE`);
});

async function lead(slug: string, more: object = {}) {
  return prisma.operatorLead.create({ data: { slug, name: slug.replace(/-/g, " "), region: "Holetown, Barbados", source: "barbados", ...more } });
}

describe("confirming a business email in person", () => {
  it("saves it, keeps the old one on the history with who confirmed it, and the visit list sees it", async () => {
    await lead("bear-jet-ski-rentals", { email: "old@bear.test" });
    expect(await confirmEmailInPerson({ slug: "bear-jet-ski-rentals", email: " Bookings@Bear.TEST ", actorEmail: "tony@arcdojo.com" })).toEqual({ ok: true, email: "bookings@bear.test" });
    const saved = await prisma.operatorLead.findUniqueOrThrow({ where: { slug: "bear-jet-ski-rentals" } });
    expect(saved.email).toBe("bookings@bear.test");
    const event = await prisma.operatorOutreachEvent.findFirstOrThrow({ where: { operatorSlug: "bear-jet-ski-rentals", type: "bd_email_confirmed" } });
    expect(event.metadata).toMatchObject({ previous: "old@bear.test", email: "bookings@bear.test", actorEmail: "tony@arcdojo.com" });
    const [stop] = await barbadosVisits();
    expect(stop).toMatchObject({ town: "Holetown", email: "bookings@bear.test", page: "claim", claimed: false });
    expect(stop.claimUrl).toMatch(/\/operator\/claim\/start\/bear-jet-ski-rentals$/);
  });

  it("refuses something that is not an email, and a page the operator has already claimed", async () => {
    await lead("claimed-co", { status: "APPROVED", email: "them@claimed.test" });
    await lead("open-co");
    expect(await confirmEmailInPerson({ slug: "open-co", email: "not an email", actorEmail: "tony@arcdojo.com" })).toMatchObject({ ok: false });
    expect(await confirmEmailInPerson({ slug: "claimed-co", email: "new@claimed.test", actorEmail: "tony@arcdojo.com" })).toMatchObject({ ok: false });
    expect((await prisma.operatorLead.findUniqueOrThrow({ where: { slug: "claimed-co" } })).email).toBe("them@claimed.test");
  });

  it("lists operators by town, with who still needs an email flagged", async () => {
    await lead("zed-surf", { region: "Bathsheba, Barbados" });
    await lead("abel-dive", { region: "Barbados", email: "a@abel.test" });
    const stops = await barbadosVisits();
    expect(stops.map((s) => [s.town, s.slug])).toEqual([["Bathsheba", "zed-surf"], ["Town not known", "abel-dive"]]);
    expect(stops[0].flags).toContain("no email on file");
    expect(stops[1].flags).not.toContain("no email on file");
  });
});
