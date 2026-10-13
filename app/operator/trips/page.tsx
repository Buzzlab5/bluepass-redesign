import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import StatusPill from "@/components/admin/StatusPill";
import RailsUnavailable from "@/components/rails/RailsUnavailable";
import { cssImage } from "@/lib/services/rails/format";
import { requireRailsOperator } from "@/lib/services/rails/guard";
import { loadTripsOverview, type TripReadiness } from "@/lib/services/rails/setup";

export const metadata = { title: "Trips · Bluepass" };

function nextStep(r: TripReadiness): { tone: "good" | "warn" | "muted"; label: string; detail: string } {
  if (r.channel !== "NATIVE") {
    const from = r.channel === "REZDY" ? "Rezdy" : "FareHarbor";
    if (r.channelIssue) return { tone: "warn", label: `Needs a change in ${from}`, detail: r.channelIssue };
    if (!r.live) return { tone: "muted", label: "Hidden", detail: `From ${from}. Switch it on to sell it here.` };
    return {
      tone: "good",
      label: `Selling from ${from}`,
      detail: r.channel === "REZDY" ? "Seats and prices come live from Rezdy." : "Books on your FareHarbor checkout.",
    };
  }
  if (r.bookable) return { tone: "good", label: "Taking bookings", detail: r.hasMeetingPoint ? "Selling on Bluepass and your booking link." : "Selling. Add a meeting point so guests know where to go." };
  if (!r.hasSchedule) return { tone: "warn", label: "Needs a schedule", detail: "Say when it runs and the calendar fills itself in." };
  if (!r.hasPrice) return { tone: "warn", label: "Needs a price", detail: "Add what a seat costs and it can be sold." };
  return { tone: "muted", label: "Draft", detail: "Ready to sell once you publish it from the dashboard." };
}

/**
 * Every trip the operator sells, and the one thing each still needs. The point of
 * the page is the right-hand column: an operator should be able to see at a glance
 * which trip is not selling and why.
 */
export default async function TripsPage() {
  const { profile, rails } = await requireRailsOperator("/operator/trips");
  if (!rails.enabled) return <RailsUnavailable title="Trips" reason={rails.reason} />;

  const trips = await loadTripsOverview(profile.id);

  return (
    <>
      <AdminPageHeader
        eyebrow="Your trips"
        title="Trips"
        support="Each trip sells itself once it has a schedule and a price, or once it comes in from Rezdy or FareHarbor. The calendar, the booking page and Kai all read from here."
        aside={<Link href="/operator/connections" className="rl-btn rl-btn--secondary">Rezdy or FareHarbor ›</Link>}
      />
      {trips.length === 0 ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">No trips yet.</p>
          <p className="ds-body-sm adm-empty__body">
            On Rezdy or FareHarbor already? <Link href="/operator/connections">Connect it</Link> and your trips come in on their own. Otherwise, create your first listing on the <Link href="/operator">dashboard</Link> and set when it runs and what it costs here.
          </p>
        </div>
      ) : (
        <ul className="rl-trips">
          {trips.map((t) => {
            const step = nextStep(t.readiness);
            return (
              <li key={t.id}>
                <Link href={`/operator/trips/${t.id}`} className="rl-trip">
                  <span className="rl-trip__thumb" style={t.heroImageUrl ? { backgroundImage: cssImage(t.heroImageUrl) } : undefined} aria-hidden />
                  <span className="rl-trip__body">
                    <span className="ds-body-lg rl-trip__title">{t.title}</span>
                    <span className="ds-caption rl-trip__meta">{t.region} · {step.detail}</span>
                  </span>
                  <StatusPill tone={step.tone}>{step.label}</StatusPill>
                  <span className="rl-trip__go" aria-hidden>›</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
