/**
 * The admin console's navigation, as data.
 *
 * Every surface added later (commission ledger, operator list, traveller
 * support) is a row appended here — the nav, the section index and the active
 * highlight all read from this one array, so none of them carry an assumption
 * about how many sections exist.
 */
import type { ConsoleIconName } from "@/components/console/ConsoleIcon";

export type AdminSection = {
  href: string;
  label: string;
  /** Which group of the side menu it sits in, and its icon there. */
  group: "Menu" | "Content" | "Money";
  icon: ConsoleIconName;
  /** One line of "what is this for", shown on the section index. */
  blurb: string;
  /**
   * Which live counter, if any, this section shows next to its label. Sections
   * with nothing queueing up behind them simply omit it.
   */
  counter?: "pendingApprovals";
};

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    href: "/admin/approvals",
    group: "Menu",
    icon: "approvals",
    label: "Approvals",
    blurb:
      "Operator claims and partner/operator applications waiting on a human decision. Approving a claim also releases the operator's own profile.",
    counter: "pendingApprovals",
  },
  {
    href: "/admin/operators",
    group: "Menu",
    icon: "operators",
    label: "Operators",
    blurb: "Every operator profile — open one to correct its details after onboarding.",
  },
  {
    href: "/admin/affiliate-trips",
    group: "Menu",
    icon: "trips",
    label: "Affiliate trips",
    blurb: "Trips we resell as a FareHarbor affiliate or Rezdy agent — add one with its booking link and it goes live on the trips page.",
  },
  {
    href: "/admin/partners",
    group: "Menu",
    icon: "partners",
    label: "Partners",
    blurb: "Every partner profile — approved, declined, and still-pending alike, not just the review queue.",
  },
  {
    href: "/admin/blog",
    group: "Content",
    icon: "blog",
    label: "Blog",
    blurb:
      "The editorial CMS behind /blog — write, optimise and publish the articles that put Bluepass on page one for its own name.",
  },
  {
    href: "/admin/operator-pages",
    group: "Menu",
    icon: "page",
    label: "Prepared pages",
    blurb: "Operator pages prepared from operators' own websites, checked fact by fact before anything is shown.",
  },
  {
    href: "/admin/creators",
    group: "Menu",
    icon: "creators",
    label: "Creators",
    blurb: "Creators operators picked when they joined: who still needs an invite, and posts an operator questioned.",
  },
  {
    href: "/admin/outreach",
    group: "Menu",
    icon: "outreach",
    label: "Outreach",
    blurb: "Cold email to operators and creators through Instantly: who is in a sequence, replies waiting for a person, and the next batch.",
  },
  {
    href: "/admin/channels",
    group: "Menu",
    icon: "channels",
    label: "Rezdy & FareHarbor",
    blurb: "Operators selling from their own booking system: Rezdy connection health, and FareHarbor's affiliate report, imported.",
  },
  {
    href: "/admin/payouts",
    group: "Money",
    icon: "payouts",
    label: "Payouts & Ledger",
    blurb:
      "Whether the settlement crons ran, and every commission and operator-payout line behind them — Australia, Indonesia, and this app's own referral ledger.",
  },
];

/**
 * Longest-prefix match, so `/admin/blog/categories` highlights Blog rather than
 * every section whose href it happens to start with, and `/admin` itself
 * highlights nothing.
 *
 * Sub-pages that are not sections of their own fall through to their parent by
 * the same rule — `/admin/operators/new` keeps Operators lit while you are
 * onboarding, which is where you came from and where saving returns you.
 */
export function activeAdminSection(pathname: string) {
  return ADMIN_SECTIONS.filter((section) => pathname === section.href || pathname.startsWith(`${section.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}
