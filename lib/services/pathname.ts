/**
 * The request header `middleware.ts` stamps onto every console request (`/admin/*` and
 * `/operator/*`).
 *
 * A Next.js layout is never told which page is rendering inside it, so the auth gates in
 * `app/admin/layout.tsx` and `app/operator/layout.tsx` have no way to build an accurate
 * `/login?next=…` on their own — a visitor deep-linked to `/admin/operators/new` would be bounced
 * to the section root after signing in. The middleware copies the real pathname into a request
 * header the layout can read back.
 *
 * This module deliberately has zero imports: `middleware.ts` runs on the edge runtime, so anything
 * it pulls in gets bundled for the edge. Keeping the constant here rather than in either guard is
 * what stops Prisma being dragged into the middleware bundle.
 */
export const CONSOLE_PATHNAME_HEADER = "x-bluepass-pathname";

/**
 * The route prefixes that are consoles rather than marketing pages.
 *
 * Each console owns its whole viewport: its own rail, its own brand mark, its own footer. The site
 * chrome has to stand aside for all of them, and there is now more than one — `/operator` shipped
 * after `/admin` and inherited none of its treatment, so the marketing nav painted over the
 * operator rail and the Kai launcher floated across an operator's own payout figures.
 * `/partner-portal` repeated the same miss when it shipped after this comment was already written
 * above it (renamed from `/creator`, then moved from `/partner` to `/partner-portal` so the dashboard
 * route stopped colliding with the public `/partners` marketing page - both old paths are now just
 * redirect stubs, no chrome to stand aside for). `/crm` has its own topbar for the same reason
 * (app/crm/layout.tsx) even though it sits behind the same admin login as `/admin` — it is still a
 * console, not a marketing page.
 */
const CONSOLE_PATHNAME_PREFIXES = ["/admin", "/operator", "/partner-portal", "/crm"];

/**
 * Whether `pathname` is inside a console area.
 *
 * Lives here, next to the header constant, so the components that stand aside share one list
 * instead of each carrying its own `startsWith` — the third console area should be one entry above,
 * not another grep for "/admin" across `components/`.
 *
 * Matches the section root and everything under it, never a route that merely starts with the same
 * characters: `/administrators` is a marketing page and must keep its nav.
 */
export function isConsolePathname(pathname: string) {
  return CONSOLE_PATHNAME_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Pages that render inside someone else's website: the booking widget an operator
 * embeds. They get none of the site's own chrome (nav, Kai, grain), because inside
 * an operator's page those would be Bluepass talking over the operator.
 */
export function isEmbedPathname(pathname: string) {
  return pathname === "/embed" || pathname.startsWith("/embed/");
}

/** Every route that stands the site chrome down: the consoles and the embeds. */
export function isChromelessPathname(pathname: string) {
  return isConsolePathname(pathname) || isEmbedPathname(pathname);
}
