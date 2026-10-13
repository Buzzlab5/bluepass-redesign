import AdminPageHeader from "@/components/admin/AdminPageHeader";
import NativeBookingCard from "@/components/operator/NativeBookingCard";
import { listKaiNativeBookings, type NativeBooking } from "@/lib/services/kai-core/native-admin";
import { requireOperatorOrRedirect } from "@/lib/services/operator/guard";

export const metadata = { title: "Your bookings · Bluepass" };

/**
 * Bookings travellers have paid for on the operator's own trips. A paid booking is waiting for an
 * answer here: accept it, or decline it and the traveller is refunded in full.
 */
export default async function OperatorBookingsPage() {
  const { profile } = await requireOperatorOrRedirect("/operator/bookings");

  let bookings: NativeBooking[] = [];
  let problem: string | null = null;

  if (profile.kaiTenantSlug) {
    try {
      bookings = await listKaiNativeBookings(profile.kaiTenantSlug, "all");
    } catch (error) {
      problem = error instanceof Error ? error.message : "Your bookings could not be loaded.";
    }
  }

  const waiting = bookings.filter((booking) => booking.status === "WAITING_OPERATOR");
  const history = bookings.filter((booking) => booking.status !== "WAITING_OPERATOR");

  return (
    <>
      <AdminPageHeader
        title="Your bookings"
        support="Travellers pay first, then you confirm. You have 24 hours to accept; if you decline or do not answer, they are refunded in full."
      />

      {problem ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">Your bookings could not be loaded.</p>
          <p className="ds-body-sm adm-empty__body">{problem}</p>
        </div>
      ) : bookings.length === 0 ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">No bookings yet.</p>
          <p className="ds-body-sm adm-empty__body">When a traveller books and pays for one of your trips, it appears here for you to accept.</p>
        </div>
      ) : (
        <>
          <section className="adm-block">
            <header className="adm-block__head">
              <h2 className="ds-headline adm-block__title">Waiting for you</h2>
            </header>
            {waiting.length === 0 ? (
              <div className="adm-card adm-empty">
                <p className="ds-body-sm adm-empty__title">Nothing to answer right now.</p>
              </div>
            ) : (
              <div className="adm-list">
                {waiting.map((booking) => (
                  <NativeBookingCard key={booking.id} booking={booking} />
                ))}
              </div>
            )}
          </section>

          {history.length > 0 ? (
            <section className="adm-block">
              <header className="adm-block__head">
                <h2 className="ds-headline adm-block__title">Earlier bookings</h2>
              </header>
              <div className="adm-list">
                {history.map((booking) => (
                  <NativeBookingCard key={booking.id} booking={booking} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
