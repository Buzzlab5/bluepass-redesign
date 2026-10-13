import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import StatusPill from "@/components/admin/StatusPill";
import RailsUnavailable from "@/components/rails/RailsUnavailable";
import { formatClock, formatDepartureShort } from "@/lib/services/rails/format";
import { requireRailsOperator } from "@/lib/services/rails/guard";
import { paymentLabel, statusLabel } from "@/lib/services/rails/labels";
import { operatorBookings, type BookingsFilter } from "@/lib/services/rails/views";

export const metadata = { title: "Bookings · Bluepass" };

const FILTERS: { value: BookingsFilter; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "cancelled", label: "Cancelled" },
];

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const { profile, rails } = await requireRailsOperator("/operator/bookings");
  if (!rails.enabled) return <RailsUnavailable title="Bookings" reason={rails.reason} />;

  const { view, q } = await searchParams;
  const filter: BookingsFilter = FILTERS.some((f) => f.value === view) ? (view as BookingsFilter) : "upcoming";
  const { rows, upcomingCount } = await operatorBookings({ operatorProfileId: profile.id, filter, q });

  return (
    <>
      <AdminPageHeader
        title="Bookings"
        support={upcomingCount === 0 ? "Nothing upcoming yet. Bookings from your link, Bluepass and Kai land here, alongside the ones you take yourself." : `${upcomingCount} upcoming.`}
        aside={<Link href="/operator/bookings/new" className="rl-btn rl-btn--primary">New booking</Link>}
      />

      <div className="rl-toolbar">
        <nav className="adm-filter__options" aria-label="Which bookings">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/operator/bookings?view=${f.value}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`ds-body-sm adm-filter__option${filter === f.value ? " is-active" : ""}`}
              aria-current={filter === f.value ? "page" : undefined}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <form className="rl-search" role="search">
          <input type="hidden" name="view" value={filter} />
          <input type="search" name="q" defaultValue={q ?? ""} placeholder="Name, phone, BP- or Rezdy reference" className="rl-input" aria-label="Search bookings" />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">{q ? `Nothing matches “${q}”.` : filter === "upcoming" ? "No upcoming bookings." : filter === "past" ? "No past bookings yet." : "Nothing cancelled."}</p>
        </div>
      ) : (
        <ul className="rl-blist">
          {rows.map((b) => {
            const s = b.status === "CONFIRMED" ? paymentLabel(b) : statusLabel(b.status);
            return (
              <li key={b.id}>
                <Link href={`/operator/bookings/${b.reference}`} className="rl-brow">
                  <span className="rl-brow__when">
                    <span className="ds-body-sm">{formatDepartureShort(b.departsAt, b.timezone)}</span>
                    <span className="ds-caption rl-brow__time">{formatClock(b.departsAt, b.timezone)}</span>
                  </span>
                  <span className="rl-brow__who">
                    <span className="ds-body rl-brow__name">
                      {b.leadName}
                      {b.checkedInAt ? <span className="ds-micro rl-tag">Checked in</span> : null}
                    </span>
                    <span className="ds-caption rl-brow__trip">{b.listing.title} · {b.externalReference ? `Rezdy ${b.externalReference} · ` : ""}{b.reference}</span>
                  </span>
                  <span className="ds-body-sm rl-brow__guests">{b.guests} {b.guests === 1 ? "guest" : "guests"}</span>
                  <span className="rl-brow__pill"><StatusPill tone={s.tone}>{s.label}</StatusPill></span>
                  <span className="rl-brow__go" aria-hidden>›</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
