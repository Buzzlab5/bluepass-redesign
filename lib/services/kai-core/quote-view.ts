/**
 * What a traveller sees on /quotes/[id]. The quote itself is Kai's (BluePassInquiry events); this is
 * only the mapping from its status to words and one possible action, kept pure so each stage is
 * covered by the default test run. Copy follows Kai's house rules: nothing is booked or charged
 * until the operator and the traveller each have done their part, and it says so.
 */
export type KaiCoreBluePassQuote = {
  id: string;
  status: "NEEDS_FINAL_PRICE" | "READY_FOR_TRAVELLER" | "TRAVELLER_APPROVED";
  operationalStatus:
    | "NEEDS_FINAL_PRICE"
    | "READY_FOR_TRAVELLER"
    | "TRAVELLER_APPROVED"
    | "PAYMENT_READY"
    | "PAID"
    | "BOOKING_CONFIRMED";
  selectedYachtName: string | null;
  operatorName: string | null;
  destination: string | null;
  dateWindow: string | null;
  guests: number | null;
  currency: string;
  grossPriceCents: number | null;
  conservationContributionCents: number | null;
  inclusions: string | null;
  exclusions: string | null;
  terms: string | null;
  paymentText: string | null;
  confirmationText: string | null;
};

export type QuoteAction = "approve" | "pay" | null;

export type QuoteView = {
  title: string;
  lead: string;
  action: QuoteAction;
  /** Set when `action` is "pay": the label needs the formatted price, which the page owns. */
  actionLabel: string | null;
  banner: string | null;
};

export function quoteView(quote: KaiCoreBluePassQuote, payment?: string | null): QuoteView {
  const operator = quote.operatorName?.trim() || "your operator";
  const canPay = Boolean(quote.grossPriceCents && quote.grossPriceCents > 0);
  const stage = quote.operationalStatus;

  const banner =
    payment === "success" && (stage === "PAYMENT_READY" || stage === "TRAVELLER_APPROVED")
      ? "Thanks. If you have just paid, it can take a minute to show here. Refresh this page to check."
      : payment === "cancelled" && stage === "PAYMENT_READY"
        ? "Payment cancelled. You have not been charged. You can pay whenever you are ready."
        : null;

  switch (stage) {
    case "NEEDS_FINAL_PRICE":
      return {
        title: `${operator} is confirming the final price.`,
        lead: "Your operator can take your trip. We will message you the moment the price is in. Nothing is booked yet and you have not been charged.",
        action: null,
        actionLabel: null,
        banner,
      };
    case "READY_FOR_TRAVELLER":
      return {
        title: `Your quote from ${operator}.`,
        lead: `Check the details below. Approving tells ${operator} you are happy with the price. It does not charge you or book anything yet.`,
        action: "approve",
        actionLabel: "Approve this quote",
        banner,
      };
    case "TRAVELLER_APPROVED":
      return {
        title: "Quote approved.",
        lead: `We have told ${operator}. They will send payment details next, and we will message you when they do. You have not been charged.`,
        action: null,
        actionLabel: null,
        banner,
      };
    case "PAYMENT_READY":
      return canPay
        ? {
            title: "Ready to pay.",
            lead: `${operator} is holding your trip. Pay securely to go ahead. Your booking is not final until ${operator} confirms it.`,
            action: "pay",
            actionLabel: null,
            banner,
          }
        : {
            title: "Almost ready.",
            lead: "The final amount is still being set. We will message you when you can pay.",
            action: null,
            actionLabel: null,
            banner,
          };
    case "PAID":
      return {
        title: "Payment received.",
        lead: `${operator} is confirming your booking. We will message you as soon as they do.`,
        action: null,
        actionLabel: null,
        banner: null,
      };
    case "BOOKING_CONFIRMED":
      return {
        title: "You are booked.",
        lead: `Your booking with ${operator} is confirmed.`,
        action: null,
        actionLabel: null,
        banner: null,
      };
  }
}
