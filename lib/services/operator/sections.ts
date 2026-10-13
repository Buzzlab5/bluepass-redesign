/**
 * The operator area's navigation, as data — the same shape as `ADMIN_SECTIONS`.
 *
 * Calendar, Bookings and Trips are the booking CMS, and only appear for an operator
 * selling through the native rails. An operator on Rezdy or FareHarbor manages
 * their departures there, and a calendar here would be a second, emptier copy of it.
 */
export type OperatorSection = {
  href: string;
  label: string;
};

export const OPERATOR_SECTIONS: OperatorSection[] = [{ href: "/operator", label: "Dashboard" }];

export const RAILS_SECTIONS: OperatorSection[] = [
  { href: "/operator/calendar", label: "Calendar" },
  { href: "/operator/bookings", label: "Bookings" },
  { href: "/operator/trips", label: "Trips" },
  { href: "/operator/connections", label: "Connections" },
];

/** Only for an operator whose page Bluepass prepared from their website. */
export const PREPARED_PAGE_SECTION: OperatorSection = { href: "/operator/your-page", label: "Your page" };

export function operatorSections(railsEnabled: boolean, hasPreparedPage = false): OperatorSection[] {
  return [
    ...OPERATOR_SECTIONS,
    ...(hasPreparedPage ? [PREPARED_PAGE_SECTION] : []),
    ...(railsEnabled ? RAILS_SECTIONS : []),
  ];
}

/** Longest-prefix match, so `/operator/bookings/BP-7K3QX9` highlights Bookings. A departure's
 *  manifest belongs to the calendar it was opened from. */
export function activeOperatorSection(pathname: string, sections: OperatorSection[] = OPERATOR_SECTIONS) {
  const path = pathname.startsWith("/operator/departures") ? "/operator/calendar" : pathname;
  return sections
    .filter((section) => path === section.href || path.startsWith(`${section.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
