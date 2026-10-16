import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { getCurrentTraveller } from "@/lib/services/auth/session";
import { CONSOLE_PATHNAME_HEADER } from "@/lib/services/pathname";

/** The profile fields every operator surface reads. Payout *details* are deliberately absent —
 *  `encryptedPayoutDetails` is write-only by design and is never decrypted back onto a page. */
const operatorProfileSelect = {
  id: true,
  status: true,
  companyName: true,
  country: true,
  websiteUrl: true,
  whatsappE164: true,
  payoutMethod: true,
  payoutContactEmail: true,
  stripeConnectAccountId: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeOnboardedAt: true,
  kaiTenantSlug: true,
  rezdySupplierId: true,
  /* Not secret, unlike the payout blob above: this is the operator's own refund terms, and the
     dashboard both displays them and seeds its editor from them. */
  cancellationPolicyTiers: true,
} as const;

export type OperatorProfileView = Prisma.OperatorProfileGetPayload<{
  select: typeof operatorProfileSelect;
}>;

export type OperatorAccountView = { id: string; email: string; displayName: string | null };

export type OperatorAccess =
  | { ok: true; account: OperatorAccountView; profile: OperatorProfileView }
  /**
   * The three ways in fail differently, and the difference is the whole point of this type.
   *
   * SIGNED_OUT is ordinary — send them to sign in. NOT_OPERATOR and NO_PROFILE are both "you should
   * not be here", and neither is a loading state: an account with the OPERATOR role but no
   * `OperatorProfile` row has nothing to show and never will until someone fixes the data, so
   * rendering an empty dashboard at it would be a lie told patiently, forever.
   */
  | { ok: false; reason: "SIGNED_OUT" | "NOT_OPERATOR" | "NO_PROFILE" };

/** The pathname of the operator page currently rendering, per `middleware.ts`. */
export async function currentOperatorPathname(fallback = "/operator") {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get(CONSOLE_PATHNAME_HEADER);

  return pathname && pathname.startsWith("/operator") ? pathname : fallback;
}

/**
 * Resolves one account against the operator area's two requirements: the role, and a profile of
 * their own.
 *
 * Split out from the redirecting wrapper below so the decision can be tested against real rows
 * without a request context — `redirect()` throws by design and `cookies()` needs one.
 */
export async function resolveOperatorAccess(accountId: string): Promise<OperatorAccess> {
  const account = await prisma.bluePassAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      email: true,
      displayName: true,
      roles: true,
      operatorProfile: { select: operatorProfileSelect },
    },
  });

  if (!account) {
    return { ok: false, reason: "SIGNED_OUT" };
  }

  /**
   * The role is checked, not the profile's existence, and there is no admin-allowlist escape hatch
   * like `requireCurrentAdmin`'s `BLUEPASS_ADMIN_EMAILS`. This area shows one specific operator
   * their own money; "which operator" has to come from the account's own row, so an env var could
   * never answer it.
   */
  if (!account.roles.includes("OPERATOR")) {
    return { ok: false, reason: "NOT_OPERATOR" };
  }

  if (!account.operatorProfile) {
    return { ok: false, reason: "NO_PROFILE" };
  }

  return {
    ok: true,
    account: { id: account.id, email: account.email, displayName: account.displayName },
    profile: account.operatorProfile,
  };
}

/** The signed-in visitor's operator access, or why they have none. */
/**
 * Memoised for the length of one request. The layout, the page and every guard in between all ask
 * "who is this operator?", and each ask is two round trips to the database (the session, then the
 * account and its profile). Answered once, a page that used to wait on four of those waits on two.
 */
export const currentOperatorAccess = cache(async (): Promise<OperatorAccess> => {
  const traveller = await getCurrentTraveller();

  if (!traveller) {
    return { ok: false, reason: "SIGNED_OUT" };
  }

  return resolveOperatorAccess(traveller.accountId);
});

/**
 * The gate every operator surface sits behind — the mirror of `requireAdminOrRedirect`.
 *
 * Call it from the layout *and* from any server action added later. The layout's check only proves
 * the account was an operator when the page loaded; a tab left open after the profile was detached
 * still holds a fully rendered page.
 *
 * Every failure lands on `/login` carrying a reason the page can explain (see `OPERATOR_NOTICES`
 * there). Bouncing an already-signed-in person to a login form is only sensible because the usual
 * cause is exactly that: they are signed in as the wrong account — their personal traveller login
 * rather than the operator one the invite went to.
 */
export async function requireOperatorOrRedirect(next: string) {
  const access = await currentOperatorAccess();

  if (!access.ok) {
    /* NO_PROFILE omits `next`: signing in again cannot fix a missing profile row, so offering to
       send them back here afterwards would just loop them through the same wall. */
    const params = new URLSearchParams({ operator: access.reason.toLowerCase().replace(/_/g, "-") });

    if (access.reason !== "NO_PROFILE") {
      params.set("next", next);
    }

    redirect(`/login?${params.toString()}`);
  }

  return access;
}
