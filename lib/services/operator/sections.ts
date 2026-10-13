/**
 * The operator area's navigation, as data — the same shape as `ADMIN_SECTIONS`.
 *
 * One entry today. It exists as an array anyway because the next pieces of operator-facing work
 * (editing a listing, payout settings) are a row appended here rather than an edit to the rail.
 */
export type OperatorSection = {
  href: string;
  label: string;
};

export const OPERATOR_SECTIONS: OperatorSection[] = [
  { href: "/operator", label: "Dashboard" },
  { href: "/operator/trips", label: "Trips" },
  { href: "/operator/bookings", label: "Bookings" },
];

/** Longest-prefix match, so a future `/operator/listings/:id` highlights its section. */
export function activeOperatorSection(pathname: string) {
  return OPERATOR_SECTIONS.filter(
    (section) => pathname === section.href || pathname.startsWith(`${section.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}
