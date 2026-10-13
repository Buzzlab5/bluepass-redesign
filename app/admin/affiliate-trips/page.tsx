import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AffiliateTripForm from "@/components/admin/AffiliateTripForm";
import StatusPill from "@/components/admin/StatusPill";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { listAffiliateTrips, PLATFORM_LABELS } from "@/lib/services/discover/affiliate-trips";
import { setAffiliateTripLiveAction } from "./actions";

export const metadata = { title: "Affiliate trips · Bluepass Admin" };

export default async function AffiliateTripsPage() {
  await requireAdminOrRedirect("/admin/affiliate-trips");

  const trips = await listAffiliateTrips();
  const live = trips.filter((trip) => trip.status === "LIVE").length;

  return (
    <>
      <AdminPageHeader
        title="Trips we resell"
        support={`${live} live of ${trips.length}. Travellers book these on FareHarbor or Rezdy from the trip page; the platform takes the payment and pays our commission monthly.`}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <AffiliateTripForm />

        {trips.length === 0 ? (
          <div className="adm-card adm-empty">
            <p className="ds-body-sm adm-empty__body">No affiliate trips yet. Add the first one above.</p>
          </div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th className="ds-micro">Trip</th>
                  <th className="ds-micro">Operator</th>
                  <th className="ds-micro">Sold through</th>
                  <th className="ds-micro">Price</th>
                  <th className="ds-micro">Status</th>
                  <th className="ds-micro"></th>
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => (
                  <tr key={trip.id}>
                    <td className="ds-body-sm">
                      {trip.title}
                      <br />
                      <a href={trip.bookingUrl} target="_blank" rel="noopener noreferrer" className="ds-micro">
                        Test booking link ↗
                      </a>
                    </td>
                    <td className="ds-body-sm">{trip.operatorName}</td>
                    <td className="ds-body-sm">{PLATFORM_LABELS[trip.bookingPlatform]}</td>
                    <td className="ds-body-sm">{trip.priceSignal ?? "—"}</td>
                    <td>
                      <StatusPill tone={trip.status === "LIVE" ? "good" : "muted"}>{trip.status}</StatusPill>
                    </td>
                    <td className="ds-body-sm">
                      <form action={setAffiliateTripLiveAction}>
                        <input type="hidden" name="listingId" value={trip.id} />
                        <input type="hidden" name="live" value={trip.status === "LIVE" ? "false" : "true"} />
                        <button type="submit" className="ds-body-sm adm-linkbtn">
                          {trip.status === "LIVE" ? "Take down" : "Put back live"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
