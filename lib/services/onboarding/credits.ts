import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * The creator credit an operator is given when they join: A$100 to put towards creators
 * featuring their trips. It is a ledger, not a balance column, so every move can be read
 * back: the welcome grant, the share set aside for each creator they pick, and a share
 * returned when a creator says no. The credit has no cash value; unspent grant credit cannot
 * be set aside after it expires.
 */

export const WELCOME_CREDIT_CENTS = 10_000;
export const CREDIT_CURRENCY = "AUD";
export const WELCOME_CREDIT_DAYS = 90;

export type CreditEntry = {
  kind: "WELCOME_GRANT" | "CAMPAIGN_HOLD" | "CAMPAIGN_RELEASE";
  amountCents: number;
  expiresAt: Date | null;
};

export type CreditBalance = {
  currency: string;
  grantedCents: number;
  /** Set aside for creators the operator picked, net of any returned. */
  setAsideCents: number;
  /** What can still be set aside for a creator. */
  availableCents: number;
  expiresAt: Date | null;
  expired: boolean;
};

export function creditBalance(entries: CreditEntry[], now: Date): CreditBalance {
  const grants = entries.filter((e) => e.kind === "WELCOME_GRANT");
  const granted = grants.reduce((sum, e) => sum + e.amountCents, 0);
  const activeGranted = grants.filter((e) => !e.expiresAt || e.expiresAt > now).reduce((sum, e) => sum + e.amountCents, 0);
  const setAside = -entries.filter((e) => e.kind !== "WELCOME_GRANT").reduce((sum, e) => sum + e.amountCents, 0);
  const expiresAt = grants.map((e) => e.expiresAt).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    currency: CREDIT_CURRENCY,
    grantedCents: granted,
    setAsideCents: Math.max(0, setAside),
    availableCents: Math.max(0, activeGranted - setAside),
    expiresAt,
    expired: grants.length > 0 && activeGranted === 0,
  };
}

/** Gives an operator their welcome credit, once; a second call changes nothing. */
export async function grantWelcomeCredit(accountId: string, now = new Date()) {
  try {
    await prisma.operatorCreditEntry.create({
      data: {
        operatorAccountId: accountId,
        kind: "WELCOME_GRANT",
        amountCents: WELCOME_CREDIT_CENTS,
        currency: CREDIT_CURRENCY,
        expiresAt: new Date(now.getTime() + WELCOME_CREDIT_DAYS * 24 * 60 * 60 * 1000),
        onceKey: `welcome:${accountId}`,
        createdAt: now,
      },
    });
    return { granted: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { granted: false as const };
    throw error;
  }
}

export async function loadCredit(accountId: string, now = new Date()): Promise<CreditBalance> {
  const entries = await prisma.operatorCreditEntry.findMany({
    where: { operatorAccountId: accountId },
    select: { kind: true, amountCents: true, expiresAt: true },
  });
  return creditBalance(entries, now);
}

/** Shares of a sum for n creators, in whole cents, the odd cents going to the first. */
export function splitCredit(totalCents: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  return Array.from({ length: n }, (_, i) => base + (i < totalCents - base * n ? 1 : 0));
}

export function formatCredit(cents: number, currency = CREDIT_CURRENCY) {
  const symbol = currency === "AUD" ? "A$" : currency === "USD" ? "US$" : `${currency} `;
  return `${symbol}${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
