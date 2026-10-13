"use client";

import { useActionState, useState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import CopyField from "@/components/rails/CopyField";
import InlineAction from "@/components/rails/InlineAction";
import PendingButton from "@/components/rails/PendingButton";
import {
  disconnectGoogleAction,
  newFeedLinkAction,
  syncGoogleNowAction,
  updateAlertsAction,
  type RailsActionState,
} from "@/app/operator/rails-actions";

const IDLE: RailsActionState = { status: "idle" };

export function GoogleConnected({
  email,
  lastSynced,
  needsReconnect,
  lastError,
}: {
  email: string;
  lastSynced: string | null;
  needsReconnect: boolean;
  lastError: string | null;
}) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [state, disconnect] = useActionState(disconnectGoogleAction, IDLE);

  return (
    <div className="adm-card rl-stack">
      <div className="rl-conn">
        <span className={`rl-conn__dot${needsReconnect ? " is-warn" : ""}`} aria-hidden />
        <div className="rl-conn__body">
          <p className="ds-body rl-conn__title">{needsReconnect ? "Google needs you to reconnect" : `Connected as ${email}`}</p>
          <p className="ds-caption rl-muted">
            {needsReconnect
              ? "Google stopped accepting Bluepass's access, so your calendar is not being updated. Reconnecting picks up every change since."
              : lastSynced
                ? `Bookings appear in your "Bluepass bookings" calendar. Last updated ${lastSynced}.`
                : 'Bookings appear in your "Bluepass bookings" calendar within a minute of being made.'}
          </p>
          {lastError && !needsReconnect ? <p className="ds-caption rl-warn">{lastError}</p> : null}
        </div>
      </div>
      <div className="rl-actions">
        {needsReconnect ? (
          <a href="/api/google/oauth/start" className="rl-btn rl-btn--primary">Reconnect Google</a>
        ) : (
          <InlineAction action={syncGoogleNowAction} label="Sync now" variant="secondary" pending="Syncing…" />
        )}
        {!disconnecting ? (
          <button type="button" className="rl-btn rl-btn--quiet" onClick={() => setDisconnecting(true)}>Disconnect…</button>
        ) : null}
      </div>
      {disconnecting && state.status !== "done" ? (
        <form action={disconnect} className="rl-danger rl-form">
          <p className="ds-body-sm">
            Removes the Bluepass bookings calendar from your Google account and stops your calendar closing departures. Your own calendars are not touched.
          </p>
          <label className="rl-switch">
            <input type="checkbox" name="confirm" />
            <span className="ds-body-sm">Yes, disconnect Google</span>
          </label>
          <ActionNotice state={state} />
          <div className="rl-actions">
            <PendingButton danger pending="Disconnecting…">Disconnect</PendingButton>
            <button type="button" className="rl-btn rl-btn--quiet" onClick={() => setDisconnecting(false)}>Keep it</button>
          </div>
        </form>
      ) : (
        <ActionNotice state={state} />
      )}
    </div>
  );
}

export function CalendarFeed({ feedUrl, appleUrl, googleUrl }: { feedUrl: string; appleUrl: string; googleUrl: string }) {
  return (
    <div className="adm-card rl-stack">
      <CopyField label="Subscribe link" value={feedUrl} />
      <div className="rl-actions">
        <a href={appleUrl} className="rl-btn rl-btn--secondary">Add to Apple Calendar</a>
        <a href={googleUrl} target="_blank" rel="noreferrer" className="rl-btn rl-btn--secondary">Subscribe in Google</a>
        <InlineAction action={newFeedLinkAction} label="Make a new link" pending="Making…" />
      </div>
      <p className="ds-caption rl-muted">
        Apple Calendar and Outlook check the link every 15 minutes or so. Google checks a subscribed link only about once a day, so for Google, connect above instead. Anyone with the link can see your guest list; make a new one if it is shared by mistake.
      </p>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
function hourLabel(h: number) {
  const suffix = h >= 12 ? "pm" : "am";
  return `${h % 12 === 0 ? 12 : h % 12}:00${suffix}`;
}

export function AlertSettings({
  whatsappNewBooking,
  whatsappDailyDigest,
  emailNewBooking,
  digestHour,
}: {
  whatsappNewBooking: boolean;
  whatsappDailyDigest: boolean;
  emailNewBooking: boolean;
  digestHour: number;
}) {
  const [state, formAction] = useActionState(updateAlertsAction, IDLE);
  return (
    <form action={formAction} className="adm-card rl-stack">
      <label className="rl-switch">
        <input type="checkbox" name="whatsappNewBooking" defaultChecked={whatsappNewBooking} />
        <span className="ds-body-sm">WhatsApp me each new booking</span>
        <span className="ds-micro rl-field__hint">Who, how many, and how full the departure is now, with a link to the manifest.</span>
      </label>
      <label className="rl-switch">
        <input type="checkbox" name="whatsappDailyDigest" defaultChecked={whatsappDailyDigest} />
        <span className="ds-body-sm">WhatsApp me tomorrow&rsquo;s departures each evening</span>
        <span className="ds-micro rl-field__hint">Only on evenings before a day with bookings.</span>
      </label>
      <label className="rl-field rl-field--inline">
        <span className="ds-micro rl-field__label">Evening summary at</span>
        <select name="digestHour" defaultValue={digestHour} className="rl-input rl-input--narrow">
          {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
        </select>
      </label>
      <label className="rl-switch">
        <input type="checkbox" name="emailNewBooking" defaultChecked={emailNewBooking} />
        <span className="ds-body-sm">Also email me each new booking</span>
      </label>
      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton variant="secondary">Save</PendingButton>
      </div>
    </form>
  );
}
