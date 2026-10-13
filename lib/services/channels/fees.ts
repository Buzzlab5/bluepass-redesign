/**
 * Taxes and fees a booking system adds on top of the ticket price, worked out the way
 * Rezdy does, so the total a traveller sees first is the total they are charged.
 * Pure and dependency-free: the booking card runs it in the browser, the server runs
 * it too, and Rezdy's own quote is still checked before any card is charged.
 */

export type ChannelFee = {
  label: string;
  kind: "percent" | "perUnit" | "perBooking";
  percent: number;
  amountCents: number;
  /** A percentage charged on the price plus the taxes before it, not on the price alone. */
  compound: boolean;
};

/** What the fees add to a party: `subtotalCents` of tickets, `units` tickets in all. */
export function feesOnTop(fees: ChannelFee[] | undefined, subtotalCents: number, units: number): number {
  if (!fees?.length || subtotalCents <= 0) return 0;
  let added = 0;
  for (const fee of fees) {
    if (fee.kind === "percent") added += Math.round((fee.compound ? subtotalCents + added : subtotalCents) * fee.percent / 100);
    else if (fee.kind === "perUnit") added += fee.amountCents * units;
    else added += fee.amountCents;
  }
  return added;
}

export function feeLabel(fees: ChannelFee[] | undefined): string {
  return fees?.length === 1 ? fees[0].label : "Taxes and fees";
}
