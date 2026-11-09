import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import QuoteButton from "@/components/quotes/QuoteButton";
import { getKaiCoreBluePassQuote, QUOTE_ID_PATTERN } from "@/lib/services/kai-core/quotes";
import { quoteView } from "@/lib/services/kai-core/quote-view";
import { formatMoney } from "@/lib/services/rails/money";
import { approveQuoteAction, payQuoteAction } from "./actions";

export const dynamic = "force-dynamic";
// The id in the address is the traveller's key to their quote: keep it out of search results and
// out of the Referer header of anything this page links to (Stripe included).
export const metadata: Metadata = {
  title: "Your quote · Bluepass",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const NOTICES: Record<string, string> = {
  approve_failed: "We could not record your approval just now. Nothing has changed. Please try again in a moment.",
  pay_failed: "Payment is not available just yet. You have not been charged. Please try again shortly, or reply to our message and we will help.",
};

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { payment, notice } = await searchParams;
  if (!QUOTE_ID_PATTERN.test(id)) notFound();

  let quote = null;
  try {
    quote = await getKaiCoreBluePassQuote(id);
  } catch (error) {
    console.warn("quotes.load_failed", { reason: error instanceof Error ? error.message : "unknown" });
    return (
      <>
        <main className="bk-done theme-light">
          <div className="bk-done__card">
            <h1 className="ds-display-md">We could not load your quote.</h1>
            <p className="ds-body bk-muted">This is on our side, and nothing about your quote has changed. Please try again in a moment.</p>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }
  if (!quote) notFound();

  const view = quoteView(quote, payment);
  const price =
    quote.grossPriceCents && quote.grossPriceCents > 0 ? formatMoney(quote.grossPriceCents, quote.currency) : null;
  const trip = quote.selectedYachtName ?? quote.destination ?? "Your trip";
  const notices = [view.banner, notice ? NOTICES[notice] : null].filter((text): text is string => Boolean(text));

  return (
    <>
      <main className="bk-done theme-light">
        <div className="bk-done__card">
          <h1 className="ds-display-md">{view.title}</h1>
          <p className="ds-body bk-muted">{view.lead}</p>

          {notices.map((text) => (
            <p key={text} className="bk-done__banner ds-body-sm" role="status">
              {text}
            </p>
          ))}

          <dl className="bk-done__facts">
            <div><dt className="ds-micro">Trip</dt><dd className="ds-body">{trip}</dd></div>
            {quote.operatorName ? <div><dt className="ds-micro">Operator</dt><dd className="ds-body">{quote.operatorName}</dd></div> : null}
            {quote.destination && quote.destination !== trip ? <div><dt className="ds-micro">Where</dt><dd className="ds-body">{quote.destination}</dd></div> : null}
            {quote.dateWindow ? <div><dt className="ds-micro">When</dt><dd className="ds-body">{quote.dateWindow}</dd></div> : null}
            {quote.guests ? <div><dt className="ds-micro">Guests</dt><dd className="ds-body">{quote.guests}</dd></div> : null}
            <div><dt className="ds-micro">Price</dt><dd className="ds-body">{price ?? "To be confirmed by the operator"}</dd></div>
          </dl>

          {quote.conservationContributionCents && quote.conservationContributionCents > 0 ? (
            <p className="bk-done__reef ds-body-sm">
              {formatMoney(quote.conservationContributionCents, quote.currency)} of this goes to protecting the ocean.
            </p>
          ) : null}

          {quote.inclusions ? <p className="bk-done__note ds-body-sm"><strong>Included.</strong> {quote.inclusions}</p> : null}
          {quote.exclusions ? <p className="bk-done__note ds-body-sm"><strong>Not included.</strong> {quote.exclusions}</p> : null}
          {quote.terms ? <p className="bk-done__note ds-body-sm"><strong>Terms.</strong> {quote.terms}</p> : null}
          {quote.operationalStatus === "PAYMENT_READY" && quote.paymentText ? (
            <p className="bk-done__note ds-body-sm"><strong>From {quote.operatorName ?? "your operator"}.</strong> {quote.paymentText}</p>
          ) : null}
          {quote.operationalStatus === "BOOKING_CONFIRMED" && quote.confirmationText ? (
            <p className="bk-done__note ds-body-sm">{quote.confirmationText}</p>
          ) : null}

          {view.action === "approve" ? (
            <form action={approveQuoteAction} className="bk-done__actions">
              <input type="hidden" name="quoteId" value={quote.id} />
              <QuoteButton pendingLabel="Approving…">{view.actionLabel}</QuoteButton>
            </form>
          ) : null}
          {view.action === "pay" ? (
            <form action={payQuoteAction} className="bk-done__actions">
              <input type="hidden" name="quoteId" value={quote.id} />
              <QuoteButton pendingLabel="Taking you to checkout…">{price ? `Pay ${price}` : "Pay now"}</QuoteButton>
            </form>
          ) : null}

          <p className="bk-done__reef ds-body-sm">
            Questions? Reply to our message and a person from the team will help. <Link href="/">Back to Bluepass</Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
