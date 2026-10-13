import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import BookingTicket from "@/components/rails/BookingTicket";
import TripWhatsAppToggle from "@/components/rails/TripWhatsAppToggle";
import { prisma } from "@/lib/db/prisma";
import { formatDepartureDay } from "@/lib/services/rails/format";
import { tripCalendarFileUrl, whatsappDigits } from "@/lib/services/rails/links";
import { formatMoney } from "@/lib/services/rails/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your booking · Bluepass", robots: { index: false, follow: false } };

/**
 * The guest's own page for one booking, linked from every email and WhatsApp
 * message. The token in the address is the only key; it opens this booking and
 * nothing else, and there is no account to sign in to.
 */
export default async function TripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await prisma.listingBooking.findUnique({
    where: { guestToken: token },
    include: {
      listing: { select: { slug: true, title: true, meetingPoint: true, confirmationNote: true, durationMinutes: true } },
      operatorProfile: { select: { companyName: true, whatsappE164: true } },
    },
  });
  if (!b) notFound();

  const listing = {
    ...b.listing,
    operatorName: b.operatorProfile.companyName ?? "your operator",
    operatorWhatsapp: b.operatorProfile.whatsappE164,
  };

  if (b.status !== "CONFIRMED" && b.status !== "REQUESTED") {
    const cancelled = b.status === "CANCELLED";
    return (
      <>
        <main className="bk-done theme-light">
          <div className="bk-done__card">
            <p className="ds-micro bk-done__ref">{b.reference}</p>
            <h1 className="ds-display-md">{cancelled ? "This booking was cancelled." : "This booking was not completed."}</h1>
            <p className="ds-body bk-muted">
              {cancelled
                ? `${b.listing.title}, ${formatDepartureDay(b.departsAt, b.timezone)}.${b.cancelReason ? ` ${b.cancelReason.replace(/[.\s]+$/, "")}.` : ""}`
                : "The payment was not finished, so no seats were kept and nothing was charged."}{" "}
              {b.refundedCents > 0 ? `Your ${formatMoney(b.refundedCents, b.currency)} has been refunded to your card.` : ""}
            </p>
            <Link href={`/book/${b.listing.slug}`} className="bk-cta">Pick another date</Link>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const canWhatsApp = Boolean(whatsappDigits(b.leadPhone));

  return (
    <>
      <main className="bk-done theme-light">
        <BookingTicket
          booking={b}
          listing={listing}
          calendarFileUrl={tripCalendarFileUrl(token)}
          headline={
            b.status === "REQUESTED" ? (
              <>
                <h1 className="ds-display-md">Waiting for {listing.operatorName} to accept.</h1>
                <p className="ds-body bk-muted">You will hear from Bluepass the moment they do. If they cannot take you, your payment comes back in full.</p>
              </>
            ) : (
              <h1 className="ds-display-md">Your booking, {b.leadName.split(" ")[0]}.</h1>
            )
          }
          extra={canWhatsApp ? <TripWhatsAppToggle token={token} on={b.whatsappOptIn} phone={b.leadPhone!} operatorName={listing.operatorName} /> : null}
        />
      </main>
      <SiteFooter />
    </>
  );
}
