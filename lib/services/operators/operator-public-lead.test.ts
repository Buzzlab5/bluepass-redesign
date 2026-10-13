import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ leadFindUnique: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { operatorLead: { findUnique: h.leadFindUnique } },
}));

import {
  loadPublicOperatorLead,
  maskEmail,
  maskedClaimEmailFor,
} from "./operator-public-lead";

const LEAD = {
  slug: "cairns-reef-dive",
  name: "Cairns Reef Dive",
  category: "Dive",
  region: "QLD",
  websiteUrl: "cairnsreefdive.com.au",
  email: "info@cairnsreefdive.com.au",
  status: "IMPORTED",
};

beforeEach(() => {
  h.leadFindUnique.mockReset();
});

describe("loadPublicOperatorLead", () => {
  it("never returns the contact address, only whether one exists", async () => {
    h.leadFindUnique.mockResolvedValue(LEAD);
    const lead = await loadPublicOperatorLead("cairns-reef-dive");

    // The whole point: these pages are reached from a cold link, so an address
    // we sourced must not be readable by whoever opens it.
    expect(JSON.stringify(lead)).not.toContain("info@cairnsreefdive.com.au");
    expect(lead?.hasEmailOnFile).toBe(true);
  });

  it("reports no address on file when the lead has none", async () => {
    h.leadFindUnique.mockResolvedValue({ ...LEAD, email: null });
    expect((await loadPublicOperatorLead("cairns-reef-dive"))?.hasEmailOnFile).toBe(false);
  });

  it("treats a blank address as no address, not as one we can send to", async () => {
    h.leadFindUnique.mockResolvedValue({ ...LEAD, email: "   " });
    expect((await loadPublicOperatorLead("cairns-reef-dive"))?.hasEmailOnFile).toBe(false);
  });

  it("returns null for an unknown slug rather than throwing", async () => {
    h.leadFindUnique.mockResolvedValue(null);
    expect(await loadPublicOperatorLead("nope")).toBeNull();
  });

  it("does not query at all for an empty slug", async () => {
    expect(await loadPublicOperatorLead("")).toBeNull();
    expect(h.leadFindUnique).not.toHaveBeenCalled();
  });

  it.each(["CLAIM_SUBMITTED", "APPROVED", "LIVE"])(
    "stops inviting a claim once the status is %s",
    async (status) => {
      h.leadFindUnique.mockResolvedValue({ ...LEAD, status });
      const lead = await loadPublicOperatorLead("cairns-reef-dive");
      expect(lead?.claimed).toBe(true);
      expect(lead?.claimable).toBe(false);
    },
  );

  it.each(["IMPORTED", "CONTACTED", "IN_DISCUSSION", "CLAIM_LINK_REQUESTED", "MANUAL_REVIEW"])(
    "still offers a claim while the status is %s",
    async (status) => {
      h.leadFindUnique.mockResolvedValue({ ...LEAD, status });
      const lead = await loadPublicOperatorLead("cairns-reef-dive");
      expect(lead?.claimed).toBe(false);
      expect(lead?.claimable).toBe(true);
    },
  );

  it("offers no claim on a declined lead", async () => {
    h.leadFindUnique.mockResolvedValue({ ...LEAD, status: "DECLINED" });
    const lead = await loadPublicOperatorLead("cairns-reef-dive");
    expect(lead?.claimable).toBe(false);
    expect(lead?.claimed).toBe(false);
  });
});

describe("maskEmail", () => {
  it("shows the domain and only the first character of the mailbox", () => {
    expect(maskEmail("info@cairnsreefdive.com.au")).toBe("i...@cairnsreefdive.com.au");
  });

  it("does not add an ellipsis to a single-character mailbox", () => {
    expect(maskEmail("a@example.com")).toBe("a@example.com");
  });

  it("degrades to a phrase rather than leaking a malformed value", () => {
    expect(maskEmail("not-an-address")).toBe("the address we hold");
    expect(maskEmail("@example.com")).toBe("the address we hold");
  });

  it("keeps a plus-addressed mailbox masked", () => {
    expect(maskEmail("bookings+bluepass@example.com")).toBe("b...@example.com");
  });
});

describe("maskedClaimEmailFor", () => {
  it("returns the masked address for the confirmation line", async () => {
    h.leadFindUnique.mockResolvedValue({ email: "reservations@example.com" });
    expect(await maskedClaimEmailFor("cairns-reef-dive")).toBe("r...@example.com");
  });

  it("returns null when there is nothing to send to", async () => {
    h.leadFindUnique.mockResolvedValue({ email: null });
    expect(await maskedClaimEmailFor("cairns-reef-dive")).toBeNull();
  });
});
