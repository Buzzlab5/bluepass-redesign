import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import BookingTicket from "@/components/rails/BookingTicket";
import { tripCalendarFileUrl } from "@/lib/services/rails/links";
import { formatMoney } from "@/lib/services/rails/money";
import { railsPayments } from "@/lib/services/rails/payments";
import { confirmationForGuest, confirmationForSession } from "@/lib/services/rails/public";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your booking · Bluepass", robots: { index: false, follow: false } };

/**
 * Where a traveller lands after paying. A Stripe checkout sends them back with the
 * checkout id only their browser was given; if Stripe's webhook has not landed yet,
 * the page asks Stripe itself, so "you're booked" never waits on a background job. A
 * Rezdy trip charged by Rezdy sends them here with their booking's own key.
 */
export default async function ConfirmedPage({ searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ session_id?: string; booking?: string }> }) {
  const { session_id: sessionId, booking: guestToken } = await searchParams;
  if (!sessionId && !guestToken) notFound();
  const found = sessionId ? await confirmationForSession(sessionId, railsPayments()) : await confirmationForGuest(guestToken!);
  if (!found) notFound();
  const { booking: b, listing } = found;
  const operatorName = listing.operatorProfile.companyName ?? "your operator";

  if (b.status === "PENDING_PAYMENT") {
    return (
      <main className="bk-done theme-light">
        <meta httpEquiv="refresh" content="3" />
        <div className="bk-done__card">
          <span className="bk-done__spinner" aria-hidden />
          <h1 className="ds-display-md">Confirming your payment…</h1>
          <p className="ds-body bk-muted">This usually takes a few seconds. The page refreshes on its own.</p>
        </div>
      </main>
    );
  }

  if (b.status !== "CONFIRMED" && b.status !== "REQUESTED") {
    return (
      <main className="bk-done theme-light">
        <div className="bk-done__card">
          <h1 className="ds-display-md">We could not keep those seats.</h1>
          <p className="ds-body bk-muted">
            {b.cancelReason ?? "The booking did not complete."}{" "}
            {b.refundedCents > 0 ? `Your ${formatMoney(b.refundedCents, b.currency)} is on its way back to your card.` : "You have not been charged."}
          </p>
          <Link href={`/book/${listing.slug}`} className="bk-cta">Pick another date</Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="bk-done theme-light">
        <BookingTicket
          booking={b}
          listing={{
            slug: listing.slug,
            title: listing.title,
            meetingPoint: listing.meetingPoint,
            confirmationNote: listing.confirmationNote,
            durationMinutes: listing.durationMinutes,
            operatorName,
            operatorWhatsapp: listing.operatorProfile.whatsappE164,
          }}
          calendarFileUrl={b.guestToken ? tripCalendarFileUrl(b.guestToken) : `/api/rails/calendar-file?session_id=${encodeURIComponent(sessionId ?? "")}`}
          headline={
            b.status === "REQUESTED" ? (
              <>
                <h1 className="ds-display-md">Your booking is with {operatorName}.</h1>
                <p className="ds-body bk-muted">
                  They accept each booking for this trip themselves. You will hear from Bluepass at {b.leadEmail} the moment they do, and if they cannot take you, your payment comes back in full.
                </p>
              </>
            ) : (
              <>
                <h1 className="ds-display-md">You&rsquo;re booked, {b.leadName.split(" ")[0]}.</h1>
                <p className="ds-body bk-muted">
                  A confirmation is on its way to {b.leadEmail}{b.whatsappOptIn ? " and to your WhatsApp" : ""}.
                  {b.guestToken ? <> This booking always lives at <Link href={`/trip/${b.guestToken}`}>your booking page</Link>.</> : null}
                </p>
              </>
            )
          }
        />
      </main>
      <SiteFooter />
    </>
  );
}
