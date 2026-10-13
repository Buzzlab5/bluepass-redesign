"use client";

import Link from "next/link";
import { useActionState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import PendingButton from "@/components/rails/PendingButton";
import { setBusyCalendarAction, type RailsActionState } from "@/app/operator/rails-actions";

const IDLE: RailsActionState = { status: "idle" };

/**
 * Which of the operator's own Google calendars closes this trip when it shows them
 * busy. The point is that a private charter they already put in their diary takes
 * the public departure off sale without a second step in Bluepass.
 */
export default function BusyCalendarPicker({
  listingId,
  current,
  calendars,
  state: connection,
}: {
  listingId: string;
  current: string | null;
  calendars: { id: string; summary: string; primary: boolean }[] | null;
  state: "connected" | "not_connected" | "unreadable";
}) {
  const [state, formAction] = useActionState(setBusyCalendarAction.bind(null, listingId), IDLE);

  if (connection === "not_connected") {
    return (
      <p className="ds-caption rl-muted">
        Already keep charters in Google Calendar? <Link href="/operator/connections">Connect it</Link> and your own calendar can close this trip&rsquo;s departures whenever you are busy.
      </p>
    );
  }
  if (connection === "unreadable" || !calendars) {
    return <p className="ds-caption rl-warn">Your Google calendars could not be listed just now. Check the connection on the <Link href="/operator/connections">Connections</Link> page.</p>;
  }

  return (
    <form action={formAction} className="adm-card rl-stack">
      <label className="rl-field">
        <span className="ds-micro rl-field__label">Also close departures when this Google calendar is busy</span>
        <select name="calendarId" defaultValue={current ?? ""} className="rl-input">
          <option value="">No calendar</option>
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>{c.primary ? `${c.summary} (your main calendar)` : c.summary}</option>
          ))}
        </select>
        <span className="ds-micro rl-field__hint">
          A departure closes for online booking whenever anything in that calendar overlaps the trip. Bluepass sees only the times, never what the event is. You can still take phone bookings on it.
        </span>
      </label>
      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton variant="secondary">Save</PendingButton>
      </div>
    </form>
  );
}
