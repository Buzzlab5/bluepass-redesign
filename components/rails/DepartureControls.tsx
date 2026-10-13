"use client";

import { useActionState, useState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import PendingButton from "@/components/rails/PendingButton";
import { NumberField } from "@/components/rails/ScheduleEditor";
import { cancelDepartureAction, setDepartureAction, type RailsActionState } from "@/app/operator/rails-actions";

const IDLE: RailsActionState = { status: "idle" };

/**
 * The three things an operator does to one departure: change how many it takes,
 * stop selling it, or call it off. Calling it off is set apart and asks twice,
 * because it emails and refunds everyone on board.
 */
export default function DepartureControls({
  listingId,
  at,
  capacity,
  ruleCapacity,
  closed,
  note,
  onboard,
  paidOnline,
  channel = "NATIVE",
}: {
  listingId: string;
  at: number;
  capacity: number;
  ruleCapacity: number;
  closed: boolean;
  note: string | null;
  onboard: number;
  paidOnline: number;
  /** Where the trip's seats live. A Rezdy departure's size is changed in Rezdy, not here. */
  channel?: string;
}) {
  const external = channel !== "NATIVE";
  const from = channel === "REZDY" ? "Rezdy" : "FareHarbor";
  const [state, formAction] = useActionState(setDepartureAction.bind(null, listingId, at), IDLE);
  const [cancelState, cancelAction] = useActionState(cancelDepartureAction.bind(null, listingId, at), IDLE);
  const [cancelling, setCancelling] = useState(false);

  return (
    <div className="rl-stack">
      <form action={formAction} className="rl-form">
        <div className="rl-grid">
          {external ? null : (
            <NumberField label="Seats on this departure" name="capacity" defaultValue={capacity} min={1} suffix={capacity === ruleCapacity ? "usual" : `usually ${ruleCapacity}`} />
          )}
          <label className="rl-field">
            <span className="ds-micro rl-field__label">Note</span>
            <input name="note" defaultValue={note ?? ""} placeholder="Second boat out" maxLength={300} className="rl-input" />
          </label>
        </div>
        <label className="rl-switch">
          <input type="checkbox" name="closed" defaultChecked={closed} />
          <span className="ds-body-sm">{external ? "Stop selling this departure on Bluepass" : "Stop selling this departure"}</span>
          <span className="ds-micro rl-field__hint">
            {external ? `Guests already booked stay booked. Close it in ${from} too, so your other channels stop selling it.` : "Guests already booked stay booked."}
          </span>
        </label>
        <ActionNotice state={state} />
        <div className="rl-actions">
          <PendingButton variant="secondary">Save</PendingButton>
        </div>
      </form>

      <div className="rl-danger">
        {cancelState.status === "done" ? (
          <ActionNotice state={cancelState} />
        ) : cancelling ? (
          <form action={cancelAction} className="rl-form">
            <p className="ds-body-sm">
              {onboard === 0
                ? "Nobody is booked. This closes the departure."
                : external
                  ? `This cancels the ${onboard} ${onboard === 1 ? "guest" : "guests"} booked through Bluepass, in ${from} as well, refunds them in full and emails them. Guests from your other channels are yours to tell in ${from}.`
                  : `This cancels all ${onboard} ${onboard === 1 ? "guest" : "guests"} on board and emails them.${paidOnline > 0 ? " Everyone who paid online is refunded in full." : ""}`}
            </p>
            <label className="rl-field">
              <span className="ds-micro rl-field__label">Reason guests will see</span>
              <input name="reason" defaultValue="Weather conditions are unsafe" maxLength={300} className="rl-input" required />
            </label>
            <label className="rl-switch">
              <input type="checkbox" name="confirm" />
              <span className="ds-body-sm">Yes, cancel this departure</span>
            </label>
            <ActionNotice state={cancelState} />
            <div className="rl-actions">
              <PendingButton danger pending="Cancelling…">Cancel departure</PendingButton>
              <button type="button" className="rl-btn rl-btn--quiet" onClick={() => setCancelling(false)}>Keep it</button>
            </div>
          </form>
        ) : (
          <div className="rl-danger__row">
            <div>
              <p className="ds-body-sm rl-danger__title">Call off this departure</p>
              <p className="ds-caption rl-danger__body">For weather or a breakdown. Everyone is told and refunded in one step.</p>
            </div>
            <button type="button" className="rl-btn rl-btn--secondary rl-btn--danger" onClick={() => setCancelling(true)}>Cancel departure…</button>
          </div>
        )}
      </div>
    </div>
  );
}
