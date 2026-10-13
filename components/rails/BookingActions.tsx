"use client";

import { useActionState, useState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import InlineAction from "@/components/rails/InlineAction";
import PendingButton from "@/components/rails/PendingButton";
import {
  cancelBookingAction,
  markCollectedAction,
  resendConfirmationAction,
  type RailsActionState,
} from "@/app/operator/rails-actions";

const IDLE: RailsActionState = { status: "idle" };

export default function BookingActions({
  bookingId,
  reference,
  canCollect,
  canResend,
  canCancel,
  refundText,
  hasEmail,
}: {
  bookingId: string;
  reference: string;
  canCollect: boolean;
  canResend: boolean;
  canCancel: boolean;
  refundText: string;
  hasEmail: boolean;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [state, cancelAction] = useActionState(cancelBookingAction.bind(null, bookingId, reference), IDLE);

  return (
    <div className="rl-stack">
      {canCollect || canResend ? (
        <div className="rl-actions">
          {canCollect ? <InlineAction action={markCollectedAction.bind(null, bookingId, reference)} label="Mark as paid to you" variant="secondary" pending="Saving…" /> : null}
          {canResend ? <InlineAction action={resendConfirmationAction.bind(null, bookingId, reference)} label="Resend confirmation" variant="secondary" pending="Sending…" /> : null}
        </div>
      ) : null}

      {canCancel ? (
        <div className="rl-danger">
          {state.status === "done" ? (
            <ActionNotice state={state} />
          ) : cancelling ? (
            <form action={cancelAction} className="rl-form">
              <p className="ds-body-sm">{refundText} {hasEmail ? "The guest is emailed and the seats go back on sale." : "The seats go back on sale. This guest left no email, so let them know yourself."}</p>
              <label className="rl-field">
                <span className="ds-micro rl-field__label">{hasEmail ? "Reason the guest will see" : "Reason"}</span>
                <input name="reason" placeholder="The boat is out of service that day" maxLength={300} className="rl-input" />
              </label>
              <label className="rl-switch">
                <input type="checkbox" name="confirm" />
                <span className="ds-body-sm">Yes, cancel this booking</span>
              </label>
              <ActionNotice state={state} />
              <div className="rl-actions">
                <PendingButton danger pending="Cancelling…">Cancel booking</PendingButton>
                <button type="button" className="rl-btn rl-btn--quiet" onClick={() => setCancelling(false)}>Keep it</button>
              </div>
            </form>
          ) : (
            <div className="rl-danger__row">
              <div>
                <p className="ds-body-sm rl-danger__title">Cancel this booking</p>
                <p className="ds-caption rl-danger__body">{refundText}</p>
              </div>
              <button type="button" className="rl-btn rl-btn--secondary rl-btn--danger" onClick={() => setCancelling(true)}>Cancel booking…</button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
