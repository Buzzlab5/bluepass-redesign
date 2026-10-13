import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import BookingChooser from "@/components/operator/BookingChooser";
import PhotoChooser from "@/components/operator/PhotoChooser";
import { chooseBookingAction, choosePhotosAction } from "@/app/operator/your-page/actions";
import { requireOperatorOrRedirect } from "@/lib/services/operator/guard";
import { preparedBookingFor } from "@/lib/services/operators/prepared-booking";
import { claimedPreparedPage } from "@/lib/services/operators/prepared-pages";

export const metadata = { title: "Your page · Bluepass" };

/**
 * The page Bluepass prepared for this operator from their website, and the two things it
 * needs from them: which of their photos travellers see (none until they choose), and,
 * once Rezdy is connected, which Rezdy trip each trip books through. Bluepass matches
 * those by name; the operator only corrects what it could not tell.
 */
export default async function OperatorPagePhotos() {
  const { account } = await requireOperatorOrRedirect("/operator/your-page");
  const [claimed, booking] = await Promise.all([claimedPreparedPage(account.id), preparedBookingFor(account.id)]);

  if (!claimed) {
    return (
      <AdminPageHeader eyebrow="Your page" title="No prepared page" support="Bluepass has not prepared a page for your business. Your trips show from what you add under Trips." />
    );
  }

  return (
    <>
      <AdminPageHeader
        eyebrow="Your page"
        title="Your Bluepass page"
        support={`We built it from ${claimed.name}'s website. Choose which of your photos travellers see, and check which Rezdy trip each trip books through.`}
        aside={claimed.pageLive ? <Link href={`/operators/${claimed.slug}`} target="_blank" className="ds-body-sm">See your page ↗</Link> : null}
      />
      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">Photos</h2>
        </header>
        {!claimed.claimApproved ? (
          <p className="ds-body adm-card" style={{ padding: 20 }}>Your claim is still being checked. You can choose photos as soon as it is approved.</p>
        ) : claimed.photos.length === 0 ? (
          <p className="ds-body adm-card" style={{ padding: 20 }}>Your page has no photos yet.</p>
        ) : (
          <>
            <p className="ds-body-sm" style={{ color: "var(--color-ink-muted)", margin: "0 0 12px" }}>Untick any you would rather we did not show. Travellers see none until you save.</p>
            <PhotoChooser action={choosePhotosAction} photos={claimed.photos} chosenBefore={Boolean(claimed.approvedAt)} />
          </>
        )}
      </section>

      {booking ? (
        <section className="adm-block">
          <header className="adm-block__head">
            <h2 className="ds-headline adm-block__title">Booking on Bluepass</h2>
          </header>
          {!booking.connected ? (
            <Link href="/operator/connections" className="adm-card op-prompt">
              <span className="ds-body">Connect Rezdy to take bookings on your page</span>
              <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>Your trips match up by name and book at your own price, into your Rezdy. ›</span>
            </Link>
          ) : booking.products.length === 0 ? (
            <p className="ds-body adm-card" style={{ padding: 20 }}>Rezdy is connected, but is not sharing any trips with Bluepass yet. Give Bluepass a rate in Rezdy Marketplace and they appear here.</p>
          ) : (
            <>
              <p className="ds-body-sm" style={{ color: "var(--color-ink-muted)", margin: "0 0 12px" }}>
                {booking.trips.filter((t) => t.listingId).length} of {booking.trips.length} trips on your page book through Rezdy. Change any match that is wrong.
              </p>
              <BookingChooser action={chooseBookingAction} trips={booking.trips} products={booking.products} />
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
