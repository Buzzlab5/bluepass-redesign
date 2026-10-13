import Link from "next/link";
import { formatMoney } from "@/lib/services/rails/money";

/**
 * The dashboard's first line for an operator on the native rails: today, this week,
 * and what Bluepass is holding for them. Three numbers and a way into each.
 */
export default function RailsToday({
  summary,
}: {
  summary: {
    hasSchedules: boolean;
    todayDepartures: number;
    todayGuests: number;
    weekGuests: number;
    owed: { currency: string; cents: number }[];
  };
}) {
  if (!summary.hasSchedules) {
    return (
      <section className="adm-block">
        <Link href="/operator/trips" className="adm-card adm-card--link rl-start">
          <span className="ds-micro rl-start__eyebrow">Start taking bookings</span>
          <span className="ds-headline">Set when your trip runs and what it costs.</span>
          <span className="ds-body-sm rl-muted">Two minutes, once. Then your calendar, booking link and Kai all sell it for you. ›</span>
        </Link>
      </section>
    );
  }

  return (
    <section className="adm-block">
      <div className="rl-stats rl-stats--links">
        <Link href="/operator/calendar" className="rl-stat">
          <span className="ds-micro rl-stat__label">Today</span>
          <span className="ds-display-md rl-stat__value">{summary.todayGuests}<span className="rl-stat__of"> {summary.todayGuests === 1 ? "guest" : "guests"}</span></span>
          <span className="ds-caption rl-muted">{summary.todayDepartures === 0 ? "Nothing going out" : `${summary.todayDepartures} ${summary.todayDepartures === 1 ? "departure" : "departures"}`}</span>
        </Link>
        <Link href="/operator/bookings" className="rl-stat">
          <span className="ds-micro rl-stat__label">Next 7 days</span>
          <span className="ds-display-md rl-stat__value">{summary.weekGuests}<span className="rl-stat__of"> {summary.weekGuests === 1 ? "guest" : "guests"}</span></span>
          <span className="ds-caption rl-muted">Booked across all trips</span>
        </Link>
        <div className="rl-stat">
          <span className="ds-micro rl-stat__label">Held for you</span>
          <span className="ds-display-md rl-stat__value">{summary.owed.length === 0 ? formatMoney(0, "AUD") : summary.owed.map((o) => formatMoney(o.cents, o.currency)).join(" · ")}</span>
          <span className="ds-caption rl-muted">Paid out after each trip runs</span>
        </div>
      </div>
    </section>
  );
}
