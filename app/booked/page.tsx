import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Booking received | Bluepass",
  robots: { index: false, follow: false },
};

/**
 * Where FareHarbor and Rezdy send a traveller back after they book a trip we resell (set as the
 * Return URL on each booking link). The platform, not Bluepass, holds the booking and the payment,
 * so this page only says what happens next and claims nothing it cannot see: we do not receive the
 * booking details, so there is no reference or summary to show here.
 */
export default function BookedPage() {
  return (
    <main className="acctpage">
      <div className="acctpage__inner legalpage__inner">
        <header className="acctpage__head">
          <span className="ds-micro acctpage__eyebrow">Booking received</span>
          <h1 className="ds-display-md acctpage__title">You&apos;re going on the water.</h1>
          <p className="ds-body acctpage__support">
            Your booking is with the operator. Their confirmation email, with your booking reference and
            meeting point, is on its way to the address you used at checkout.
          </p>
        </header>

        <div className="legalpage__body">
          <section>
            <h2 className="ds-headline">What happens next</h2>
            <ul className="ds-body legalpage__list">
              <li>Keep the operator&apos;s confirmation email. Changes and cancellations go through them.</li>
              <li>Didn&apos;t get it within an hour? Check your spam folder, then contact the operator directly.</li>
            </ul>
          </section>
          <p className="ds-body">
            <Link href="/">Find another trip →</Link>
          </p>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
