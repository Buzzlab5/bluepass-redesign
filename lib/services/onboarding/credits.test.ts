import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { creditBalance, formatCredit, grantWelcomeCredit, loadCredit, splitCredit } from "@/lib/services/onboarding/credits";
import { resetRailsTables, seedOperator } from "@/lib/services/rails/test-fixtures";

const now = new Date("2026-10-19T00:00:00Z");
const later = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

describe("an operator's creator credit", () => {
  it("is the grant less what has been set aside for creators, plus what came back", () => {
    const balance = creditBalance([
      { kind: "WELCOME_GRANT", amountCents: 10_000, expiresAt: later(90) },
      { kind: "CAMPAIGN_HOLD", amountCents: -3_334, expiresAt: null },
      { kind: "CAMPAIGN_HOLD", amountCents: -3_333, expiresAt: null },
      { kind: "CAMPAIGN_RELEASE", amountCents: 3_333, expiresAt: null },
    ], now);
    expect(balance).toMatchObject({ grantedCents: 10_000, setAsideCents: 3_334, availableCents: 6_666, expired: false });
  });

  it("cannot be set aside once the grant has expired, though what was set aside stands", () => {
    const balance = creditBalance([
      { kind: "WELCOME_GRANT", amountCents: 10_000, expiresAt: later(90) },
      { kind: "CAMPAIGN_HOLD", amountCents: -3_334, expiresAt: null },
    ], later(91));
    expect(balance).toMatchObject({ availableCents: 0, setAsideCents: 3_334, expired: true });
  });

  it("shares a sum in whole cents, the odd cents first", () => {
    expect(splitCredit(10_000, 3)).toEqual([3_334, 3_333, 3_333]);
    expect(splitCredit(3_333, 1)).toEqual([3_333]);
    expect(splitCredit(100, 0)).toEqual([]);
    expect(formatCredit(10_000)).toBe("A$100");
    expect(formatCredit(3_334)).toBe("A$33.34");
  });
});

describe("the welcome grant", () => {
  beforeEach(resetRailsTables);

  it("is given once, however often the operator arrives", async () => {
    const { account } = await seedOperator();
    expect(await grantWelcomeCredit(account.id, now)).toEqual({ granted: true });
    expect(await grantWelcomeCredit(account.id, now)).toEqual({ granted: false });
    expect(await prisma.operatorCreditEntry.count({ where: { operatorAccountId: account.id } })).toBe(1);
    expect(await loadCredit(account.id, now)).toMatchObject({ availableCents: 10_000, currency: "AUD" });
  });
});
