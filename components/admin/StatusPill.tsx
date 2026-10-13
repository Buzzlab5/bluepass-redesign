/**
 * The page's colour vocabulary, in one place.
 *
 * The payouts page is meant to be read in three seconds, which only works if a given tone always
 * means the same thing: red is broken, amber is waiting on someone, green is done, grey is inert.
 * Mapping every status through here rather than per-call-site is what keeps that promise — a
 * PENDING ledger row and a FAILURE cron must not both be able to render as "some colour".
 */
export type PillTone = "bad" | "warn" | "good" | "muted";

const LEDGER_TONES: Record<string, PillTone> = {
  PENDING: "warn",
  FINALIZED: "good",
  VOIDED: "muted",
};

const CRON_TONES: Record<string, PillTone> = {
  SUCCESS: "good",
  PARTIAL: "warn",
  FAILURE: "bad",
  NEVER_RUN: "bad",
};

const PAYOUT_TONES: Record<string, PillTone> = {
  TRANSFERRED: "good",
  RELEASED: "good",
  PAID: "good",
  PENDING: "warn",
  FAILED: "bad",
  FAILURE: "bad",
};

// OPEN and OPERATOR_NOTIFIED both still read as "needs a look" from an operator's own dashboard -
// the distinction between "Bluepass hasn't told you yet" and "Bluepass told you" isn't the operator's
// to track, only "is this handled" is (CLOSED).
const MANUAL_INQUIRY_TONES: Record<string, PillTone> = {
  OPEN: "warn",
  OPERATOR_NOTIFIED: "warn",
  CLOSED: "muted",
};

export function ledgerTone(status: string): PillTone {
  return LEDGER_TONES[status] ?? "muted";
}

export function manualInquiryTone(status: string): PillTone {
  return MANUAL_INQUIRY_TONES[status] ?? "muted";
}

export function cronTone(status: string): PillTone {
  return CRON_TONES[status] ?? "muted";
}

export function payoutTone(status: string): PillTone {
  return PAYOUT_TONES[status.toUpperCase()] ?? "muted";
}

/** "OPERATOR_NOTIFIED" -> "Operator notified": raw database values read as plain words, never in capitals. */
export function humanizeStatus(value: string) {
  if (!/^[A-Z0-9_]+$/.test(value)) return value;
  const words = value.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function StatusPill({
  tone,
  children,
  title,
}: {
  tone: PillTone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span className={`ds-micro adm-status adm-status--${tone}`} title={title}>
      {typeof children === "string" ? humanizeStatus(children) : children}
    </span>
  );
}
