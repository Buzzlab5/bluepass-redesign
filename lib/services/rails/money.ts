import {
  CONSERVATION_PCT,
  PAYMENT_PROCESSING_PCT,
  PLATFORM_FEE_PCT_UNREFERRED,
} from "@/lib/constants/economics";

/**
 * How one online booking's money divides.
 *
 * The rates come from economics.ts, which mirrors Kai's ledger, so a native booking
 * and a Rezdy booking of the same fare leave the operator the same amount. The
 * operator's share does not depend on whether a creator referred the traveller:
 * a referral comes out of Bluepass's fee, never theirs (see economics.ts).
 *
 * Only online bookings divide. A booking the operator took and was paid for
 * directly never passed through Bluepass, so there is nothing to take a share of,
 * and no 5% either: promising the reef money we never held would be a promise we
 * could only keep out of our own pocket.
 */
export function splitOnlineBooking(totalCents: number) {
  const conservationCents = Math.round(totalCents * CONSERVATION_PCT);
  const bluepassShareCents = Math.round(
    totalCents * (CONSERVATION_PCT + PAYMENT_PROCESSING_PCT + PLATFORM_FEE_PCT_UNREFERRED),
  );
  return {
    conservationCents,
    operatorNetCents: totalCents - bluepassShareCents,
  };
}

/**
 * "A$1,240", "BBD 240" or "IDR 1,500,000". en-US is used for the symbol rather than
 * en-AU because en-AU writes Australian dollars as a bare "$", which a traveller
 * booking from the US or Singapore would read as their own currency.
 */
export function formatMoney(cents: number, currency: string): string {
  const code = currency.toUpperCase();
  const amount = cents / 100;
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(whole ? 0 : 2)}`;
  }
}
