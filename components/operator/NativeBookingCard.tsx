"use client";

import { useActionState } from "react";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import StatusPill, { type PillTone } from "@/components/admin/StatusPill";
import { decideBookingAction, type BookingDecisionState } from "@/app/operator/bookings/actions";
import { formatMoney } from "@/lib/services/operator/native-trip-editor";
import type { NativeBooking } from "@/lib/services/kai-core/native-admin";

const IDLE: BookingDecisionState = { status: "idle" };

const TONES: Record<NativeBooking["status"], PillTone> = {
  WAITING_OPERATOR: "warn",
  CONFIRMED: "good",
  DECLINED: "muted",
  CANCELLED: "muted",
  EXPIRED: "muted",
  HELD: "muted",
};

const LABELS: Record<NativeBooking["status"], string> = {
  WAITING_OPERATOR: "Needs your answer",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined, refunded",
  CANCELLED: "Cancelled",
  EXPIRED: "Not answered, refunded",
  HELD: "Not paid",
};

function when(localDate: string, localTime: string) {
  const date = new Date(`${localDate}T00:00:00Z`);
  const day = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  return `${day} at ${localTime}`;
}

function deadline(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/**
 * One booking. A booking waiting on the operator shows Accept and Decline; everything else is a
 * quiet record. Declining refunds the traveller in full, which the button says before it is pressed.
 */
export default function NativeBookingCard({ booking }: { booking: NativeBooking }) {
  const waiting = booking.status === "WAITING_OPERATOR" && booking.paymentAttemptId !== null;
  const attemptId = booking.paymentAttemptId ?? "";
  const [acceptState, acceptAction, accepting] = useActionState(decideBookingAction.bind(null, attemptId, "ACCEPT"), IDLE);
  const [declineState, declineAction, declining] = useActionState(decideBookingAction.bind(null, attemptId, "DECLINE"), IDLE);
  const busy = accepting || declining;
  const state = acceptState.status !== "idle" ? acceptState : declineState;
  const answered = state.status === "done";

  return (
    <article className="adm-card adm-review adm-booking">
      <header className="adm-review__head">
        <div className="adm-review__ident">
          <h3 className="ds-body-lg adm-review__title">{booking.tripTitle}</h3>
          <span className="ds-micro adm-ledger__kind">{when(booking.localDate, booking.localTime)}</span>
        </div>
        <StatusPill tone={answered ? "good" : TONES[booking.status]}>{answered ? "Answered" : LABELS[booking.status]}</StatusPill>
      </header>

      <dl className="adm-facts">
        <div className="adm-facts__row">
          <dt className="ds-micro adm-facts__label">Traveller</dt>
          <dd className="ds-body-sm adm-facts__value">
            {booking.travellerName} · {booking.travellerEmail}
            {booking.travellerPhone ? ` · ${booking.travellerPhone}` : ""}
          </dd>
        </div>
        <div className="adm-facts__row">
          <dt className="ds-micro adm-facts__label">Tickets</dt>
          <dd className="ds-body-sm adm-facts__value">
            {[...booking.tickets, ...booking.extras].map((item) => `${item.quantity} × ${item.optionLabel}`).join(", ") || `${booking.seats} seats`}
          </dd>
        </div>
        <div className="adm-facts__row">
          <dt className="ds-micro adm-facts__label">Paid</dt>
          <dd className="ds-body-sm adm-facts__value">{formatMoney(booking.totalCents, booking.currency)}</dd>
        </div>
        {waiting && booking.operatorDeadlineAt ? (
          <div className="adm-facts__row">
            <dt className="ds-micro adm-facts__label">Answer by</dt>
            <dd className="ds-body-sm adm-facts__value">
              {deadline(booking.operatorDeadlineAt)}. If you do not answer, the traveller is refunded in full.
            </dd>
          </div>
        ) : null}
        {booking.decisionNote ? (
          <div className="adm-facts__row">
            <dt className="ds-micro adm-facts__label">Your note</dt>
            <dd className="ds-body-sm adm-facts__value">{booking.decisionNote}</dd>
          </div>
        ) : null}
      </dl>

      {waiting && !answered ? (
        <>
          <div className="adm-booking__answer">
            <form action={acceptAction}>
              <Button type="submit" variant="primary" magnetic={false} disabled={busy}>
                {accepting ? "Accepting…" : "Accept booking"}
              </Button>
            </form>
            <form action={declineAction}>
              <Button type="submit" variant="secondary" magnetic={false} disabled={busy}>
                {declining ? "Declining…" : "Decline and refund"}
              </Button>
            </form>
          </div>
          <p className="ds-micro adm-form__help">Declining sends the traveller their money back in full and frees the seats.</p>
        </>
      ) : null}

      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
    </article>
  );
}
