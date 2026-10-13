"use client";

import { useActionState, useState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import PendingButton from "@/components/rails/PendingButton";
import { sendDepartureUpdateAction, type RailsActionState } from "@/app/operator/rails-actions";

const IDLE: RailsActionState = { status: "idle" };

/**
 * One message to everyone on a departure: running late, a different pier, bring a
 * jumper. Says up front who it will reach and how, so nobody is assumed told who
 * was not.
 */
export default function DepartureMessage({
  listingId,
  at,
  reach,
}: {
  listingId: string;
  at: number;
  reach: { whatsapp: number; email: number; unreachable: string[] };
}) {
  const [state, formAction] = useActionState(sendDepartureUpdateAction.bind(null, listingId, at), IDLE);
  const [message, setMessage] = useState("");
  const total = reach.whatsapp + reach.email;
  const how = [
    reach.whatsapp ? `${reach.whatsapp} on WhatsApp` : null,
    reach.email ? `${reach.email} by email` : null,
  ].filter(Boolean).join(" and ");

  return (
    <form action={formAction} className="adm-card rl-stack">
      <label className="rl-field">
        <span className="ds-micro rl-field__label">Message everyone on this departure</span>
        <textarea
          name="message"
          rows={3}
          maxLength={300}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="We are leaving from Pier C today, two berths along from the usual spot."
          className="rl-input rl-input--area"
        />
        <span className="ds-micro rl-field__hint">
          {total === 0
            ? "Nobody on this departure can be reached by WhatsApp or email."
            : `Goes to ${how}.`}
          {reach.unreachable.length > 0 ? ` Call ${reach.unreachable.join(", ")} yourself; they left neither.` : ""}
        </span>
      </label>
      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton variant="secondary" pending="Sending…" disabled={total === 0 || message.trim().length < 5}>
          {total > 0 ? `Send to ${total} ${total === 1 ? "booking" : "bookings"}` : "Send"}
        </PendingButton>
      </div>
    </form>
  );
}
