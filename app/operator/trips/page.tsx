import AdminPageHeader from "@/components/admin/AdminPageHeader";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { requireOperatorOrRedirect } from "@/lib/services/operator/guard";
import { formatMoney } from "@/lib/services/operator/native-trip-editor";
import { loadOperatorTrips, operatorCanUseNativeTrips } from "@/lib/services/operator/native-trips";

export const metadata = { title: "Your trips · Bluepass" };

/** The trips an operator sells through Bluepass, with a way to add one. */
export default async function OperatorTripsPage() {
  const { profile } = await requireOperatorOrRedirect("/operator/trips");

  if (!operatorCanUseNativeTrips(profile)) {
    return (
      <>
        <AdminPageHeader title="Your trips" support="Your trips come from your Rezdy account." />
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">Trips are managed in Rezdy.</p>
          <p className="ds-body-sm adm-empty__body">
            Bluepass reads your trips, prices and availability from Rezdy, so change them there and they show up here.
          </p>
        </div>
      </>
    );
  }

  const loaded = await loadOperatorTrips(profile);

  return (
    <>
      <AdminPageHeader
        title="Your trips"
        support="The trips travellers can book with you: prices, departure times and how many seats each one has."
        aside={
          <Button href="/operator/trips/new" variant="primary" magnetic={false}>
            New trip
          </Button>
        }
      />

      {!loaded.ok ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">Your trips could not be loaded.</p>
          <p className="ds-body-sm adm-empty__body">{loaded.message}</p>
        </div>
      ) : loaded.trips.length === 0 ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">No trips yet.</p>
          <p className="ds-body-sm adm-empty__body">
            Add your first trip: what it is, what it costs and when it runs. You can save it as a draft and publish it when it is ready.
          </p>
        </div>
      ) : (
        <div className="adm-list">
          {loaded.trips.map(({ trip, listingStatus }) => (
            <a key={trip.id} href={`/operator/trips/${trip.id}`} className="adm-card adm-review adm-card--link">
              <header className="adm-review__head">
                <div className="adm-review__ident">
                  <h3 className="ds-body-lg adm-review__title">{trip.title}</h3>
                  <span className="ds-micro adm-ledger__kind">
                    {trip.lowestTicketCents === null ? "No price yet" : `From ${formatMoney(trip.lowestTicketCents, trip.currency)}`}
                    {" · "}
                    {trip.schedules.length === 0
                      ? "No departure times"
                      : `${trip.schedules.length} departure time${trip.schedules.length === 1 ? "" : "s"}`}
                  </span>
                </div>
                <StatusPill tone={trip.status === "PUBLISHED" ? "good" : "warn"}>{trip.status === "PUBLISHED" ? "On sale" : "Draft"}</StatusPill>
              </header>
              {listingStatus === "ARCHIVED" ? (
                <p className="ds-body-sm">Bluepass has switched this trip off on bluepass.co. Contact Bluepass to have it turned back on.</p>
              ) : null}
            </a>
          ))}
        </div>
      )}
    </>
  );
}
