"use client";

import { useActionState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import PendingButton from "@/components/rails/PendingButton";
import { NumberField } from "@/components/rails/ScheduleEditor";
import { saveLogisticsAction, type RailsActionState } from "@/app/operator/rails-actions";

const IDLE: RailsActionState = { status: "idle" };

/** What a guest needs once booked: how long, where to meet, what to bring. Goes in every confirmation. */
export default function LogisticsForm({
  listingId,
  durationMinutes,
  meetingPoint,
  confirmationNote,
}: {
  listingId: string;
  durationMinutes: number | null;
  meetingPoint: string | null;
  confirmationNote: string | null;
}) {
  const [state, formAction] = useActionState(saveLogisticsAction.bind(null, listingId), IDLE);
  return (
    <form action={formAction} className="rl-form">
      <div className="rl-grid">
        <NumberField label="Trip length" name="hours" defaultValue={durationMinutes ? Math.floor(durationMinutes / 60) : ""} min={0} suffix="hours" />
        <NumberField label="and" name="minutes" defaultValue={durationMinutes ? durationMinutes % 60 || "" : ""} min={0} suffix="minutes" invalid={state.status === "error" && state.field === "durationMinutes"} />
      </div>
      <label className="rl-field">
        <span className="ds-micro rl-field__label">Where guests meet</span>
        <input name="meetingPoint" defaultValue={meetingPoint ?? ""} placeholder="Marina Pier B, Cairns. Look for the blue flag." maxLength={200} className="rl-input" />
      </label>
      <label className="rl-field">
        <span className="ds-micro rl-field__label">Note for every guest</span>
        <textarea
          name="confirmationNote"
          defaultValue={confirmationNote ?? ""}
          rows={4}
          maxLength={1200}
          placeholder="Arrive 20 minutes early. Bring a towel, a hat and reef-safe sunscreen. Lunch is included."
          className="rl-input rl-input--area"
        />
      </label>
      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton>Save</PendingButton>
      </div>
    </form>
  );
}
