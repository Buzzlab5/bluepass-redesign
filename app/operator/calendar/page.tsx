import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import RailsUnavailable from "@/components/rails/RailsUnavailable";
import { addDays } from "@/lib/services/operators/listing-availability";
import { formatLocalTime } from "@/lib/services/rails/format";
import { channelLabel } from "@/lib/services/rails/labels";
import { requireRailsOperator } from "@/lib/services/rails/guard";
import { operatorCalendar, operatorToday, type CalendarItem } from "@/lib/services/rails/views";

export const metadata = { title: "Calendar · Bluepass" };

const DAY = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const RANGE = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });

function asDate(ymd: string) {
  return new Date(`${ymd}T00:00:00Z`);
}

function status(item: CalendarItem, now: number): { label: string; tone: string } | null {
  const d = item.departure;
  // Once it has left, the only thing worth saying is how many went.
  if (d.departsAt.getTime() < now) return null;
  if (d.closed) return { label: d.note ? `Closed · ${d.note}` : "Closed", tone: "bad" };
  // Booked before the diary entry went in: the boat may be promised twice.
  if (d.busy && item.bookedGuests > 0) return { label: "Clashes with your calendar", tone: "bad" };
  if (d.busy) return { label: "Busy in your calendar", tone: "bad" };
  if (d.seatsLeft === 0) return { label: "Full", tone: "good" };
  if (item.bookedGuests > 0 && item.bookedGuests < d.minGuests) return { label: `Needs ${d.minGuests - item.bookedGuests} more to run`, tone: "warn" };
  if (d.block === "cutoff") return { label: "Online sales closed", tone: "muted" };
  return null;
}

/**
 * The week, one day per row, each departure with how full it is. A list rather than
 * a grid, because the question an operator brings here is "what is going out and who
 * is on it", and a list answers it on a phone on the jetty as well as on a laptop.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { profile, rails } = await requireRailsOperator("/operator/calendar");
  if (!rails.enabled) return <RailsUnavailable title="Calendar" reason={rails.reason} />;

  const { week } = await searchParams;
  const { today } = await operatorToday(profile.id);
  // A rolling seven days from today by default, not Monday to Sunday: on the jetty the
  // question is what goes out next, and a calendar week spends the top of the screen
  // on days already gone.
  const first = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : today;
  const last = addDays(first, 6);

  const calendar = await operatorCalendar({ operatorProfileId: profile.id, from: first, to: last });
  const now = Date.now();
  const guests = calendar.days.reduce((n, d) => n + d.items.reduce((m, i) => m + i.bookedGuests, 0), 0);
  const departures = calendar.days.reduce((n, d) => n + d.items.length, 0);
  const isThisWeek = first === today;

  return (
    <>
      <AdminPageHeader
        context={isThisWeek ? "Next 7 days" : `${RANGE.format(asDate(first))} to ${RANGE.format(asDate(last))}`}
        title="Calendar"
        support={departures === 0 ? "Nothing scheduled in these seven days." : `${departures} ${departures === 1 ? "departure" : "departures"} · ${guests} ${guests === 1 ? "guest" : "guests"} booked`}
        aside={
          <div className="rl-actions">
            <nav className="rl-weeknav" aria-label="Week">
              <Link href={`/operator/calendar?week=${addDays(first, -7)}`} className="rl-weeknav__step" aria-label="Previous week">‹</Link>
              <Link href="/operator/calendar" className={`ds-caption rl-weeknav__today${isThisWeek ? " is-current" : ""}`}>Today</Link>
              <Link href={`/operator/calendar?week=${addDays(first, 7)}`} className="rl-weeknav__step" aria-label="Next week">›</Link>
            </nav>
            <Link href="/operator/bookings/new" className="rl-btn rl-btn--primary">New booking</Link>
          </div>
        }
      />

      {!calendar.hasSchedules ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">No departures to show yet.</p>
          <p className="ds-body-sm adm-empty__body">
            Set when your trip runs on the <Link href="/operator/trips">Trips</Link> page and the calendar fills itself in, or <Link href="/operator/connections">connect Rezdy or FareHarbor</Link>.
          </p>
        </div>
      ) : (
        <ol className="rl-week">
          {calendar.days.map((day) => (
            <li key={day.date} className={`rl-weekday${day.date === today ? " is-today" : ""}${day.date < today ? " is-past" : ""}`}>
              <h2 className="ds-body-sm rl-weekday__head">
                {DAY.format(asDate(day.date))}
                {day.date === today ? <span className="ds-micro rl-tag rl-tag--blue">Today</span> : null}
              </h2>
              {day.items.length === 0 && day.closed.length === 0 ? (
                <p className="ds-caption rl-weekday__empty">No departures</p>
              ) : (
                <ul className="rl-deps">
                  {day.items.map((item) => {
                    const d = item.departure;
                    const external = item.channel !== "NATIVE";
                    const fill = d.capacity > 0 ? Math.min(1, item.bookedGuests / d.capacity) : 0;
                    const s = external ? (d.closed ? { label: d.note ? `Closed on Bluepass · ${d.note}` : "Closed on Bluepass", tone: "bad" } : null) : status(item, now);
                    return (
                      <li key={`${item.listingId}-${d.departsAt.getTime()}`}>
                        <Link href={`/operator/departures/${item.listingId}/${d.departsAt.getTime()}`} className={`rl-dep${d.closed ? " is-closed" : ""}`}>
                          <span className="ds-body rl-dep__time">{formatLocalTime(d.localTime)}</span>
                          <span className="rl-dep__body">
                            <span className="ds-body-sm rl-dep__title">
                              {item.title}
                              {external ? <span className="ds-micro rl-tag">{channelLabel(item.channel)}</span> : null}
                            </span>
                            {external ? null : (
                              <span className="rl-fill" aria-hidden>
                                <span className="rl-fill__bar" style={{ width: `${fill * 100}%` }} />
                              </span>
                            )}
                          </span>
                          <span className="rl-dep__count">
                            <span className="ds-body-sm">
                              {item.bookedGuests}
                              {external ? <span className="rl-dep__of"> via Bluepass</span> : <span className="rl-dep__of"> / {d.capacity}</span>}
                            </span>
                            {s ? <span className={`ds-micro rl-dep__status rl-dep__status--${s.tone}`}>{s.label}</span> : null}
                            {item.pendingGuests > 0 ? <span className="ds-micro rl-dep__status rl-dep__status--muted">{item.pendingGuests} paying now</span> : null}
                          </span>
                          <span className="rl-dep__go" aria-hidden>›</span>
                        </Link>
                      </li>
                    );
                  })}
                  {day.closed.map((c) => (
                    <li key={`closed-${c.title}`} className="rl-dep rl-dep--static is-closed">
                      <span className="ds-body rl-dep__time">·</span>
                      <span className="rl-dep__body">
                        <span className="ds-body-sm rl-dep__title">{c.title}</span>
                        <span className="ds-micro rl-dep__status rl-dep__status--muted">Closed · {c.reason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
