"use client";

import { useActionState, useState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import InlineAction from "@/components/rails/InlineAction";
import PendingButton from "@/components/rails/PendingButton";
import { DateField } from "@/components/rails/ScheduleEditor";
import { addBlackoutAction, removeBlackoutAction, type RailsActionState } from "@/app/operator/rails-actions";

const IDLE: RailsActionState = { status: "idle" };

export type BlackoutRow = { id: string; startDate: string; endDate: string; reason: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function day(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Maintenance, holidays, the slipway. Dates come off the booking page and Kai stops offering them. */
export default function ClosedDates({ listingId, blackouts }: { listingId: string; blackouts: BlackoutRow[] }) {
  const [adding, setAdding] = useState(false);
  const [state, formAction] = useActionState(addBlackoutAction.bind(null, listingId), IDLE);
  const [key, setKey] = useState(0);

  return (
    <div className="rl-stack">
      {blackouts.length > 0 ? (
        <ul className="rl-rows">
          {blackouts.map((b) => (
            <li key={b.id} className="rl-rows__item">
              <div className="rl-rows__main">
                <span className="ds-body rl-rows__title">
                  {b.startDate === b.endDate ? day(b.startDate) : `${day(b.startDate)} to ${day(b.endDate)}`}
                </span>
                {b.reason ? <span className="ds-caption rl-rows__meta">{b.reason}</span> : null}
              </div>
              <div className="rl-rows__actions">
                <InlineAction action={removeBlackoutAction.bind(null, listingId, b.id)} label="Reopen" pending="Reopening…" />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <form key={key} action={formAction} className="rl-form">
          <div className="rl-grid">
            <DateField label="From" name="startDate" defaultValue="" required />
            <DateField label="To" name="endDate" defaultValue="" />
            <label className="rl-field">
              <span className="ds-micro rl-field__label">Reason</span>
              <input name="reason" placeholder="Annual maintenance" maxLength={120} className="rl-input" />
            </label>
          </div>
          <ActionNotice state={state} />
          <div className="rl-actions">
            <PendingButton>Close these dates</PendingButton>
            <button type="button" className="rl-btn rl-btn--quiet" onClick={() => { setAdding(false); setKey((k) => k + 1); }}>
              {state.status === "done" ? "Done" : "Cancel"}
            </button>
          </div>
        </form>
      ) : (
        <div className="rl-actions">
          <button type="button" className="rl-btn rl-btn--secondary" onClick={() => setAdding(true)}>Close some dates</button>
        </div>
      )}
    </div>
  );
}
