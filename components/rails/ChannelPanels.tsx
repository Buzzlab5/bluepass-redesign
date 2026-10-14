"use client";

import { useActionState, useEffect, useState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import PendingButton from "@/components/rails/PendingButton";
import {
  addFareHarborTripAction,
  connectFareHarborAction,
  connectRezdyAction,
  disconnectFareHarborAction,
  disconnectRezdyAction,
  rezdyAutoPublishAction,
  syncRezdyAction,
  type RailsActionState,
} from "@/app/operator/rails-actions";

const IDLE: RailsActionState = { status: "idle" };

/** The operator's own timezone, from their browser, sent with FareHarbor forms (see connect.ts). */
function ZoneField() {
  const [zone, setZone] = useState("");
  useEffect(() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""), []);
  return <input type="hidden" name="timezone" value={zone} />;
}

export type ChannelConnectionView = {
  status: "WAITING" | "CONNECTED" | "BROKEN";
  accountKey: string;
  displayName: string | null;
  lastSynced: string | null;
  lastError: string | null;
  autoPublish: boolean;
};

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="rl-steps">
      {steps.map((s, i) => <li key={i} className="ds-body-sm">{s}</li>)}
    </ol>
  );
}

/** One button and the sentence it comes back with. */
function ActionButton({ action, label, pending, variant = "secondary" }: {
  action: (prev: RailsActionState) => Promise<RailsActionState>;
  label: string;
  pending: string;
  variant?: "primary" | "secondary" | "quiet";
}) {
  const [state, formAction] = useActionState(action, IDLE);
  return (
    <form action={formAction} className="rl-stack rl-stack--tight">
      <div className="rl-actions">
        <PendingButton variant={variant} pending={pending}>{label}</PendingButton>
      </div>
      <ActionNotice state={state} />
    </form>
  );
}

function Disconnect({ action, name, what }: { action: (prev: RailsActionState, form: FormData) => Promise<RailsActionState>; name: string; what: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, IDLE);
  if (!open) {
    return <button type="button" className="rl-btn rl-btn--quiet rl-self-start" onClick={() => setOpen(true)}>Disconnect {name}…</button>;
  }
  return (
    <form action={formAction} className="rl-danger rl-form">
      <p className="ds-body-sm">{what}</p>
      <label className="rl-switch">
        <input type="checkbox" name="confirm" />
        <span className="ds-body-sm">Yes, disconnect {name}</span>
      </label>
      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton danger pending="Disconnecting…">Disconnect</PendingButton>
        <button type="button" className="rl-btn rl-btn--quiet" onClick={() => setOpen(false)}>Keep it</button>
      </div>
    </form>
  );
}

/**
 * Rezdy, from the operator's side: name the account once, share trips with Bluepass
 * in Rezdy, and everything after that happens on its own.
 */
export function RezdyConnection({
  configured,
  connection,
  trips,
  steps,
}: {
  configured: boolean;
  connection: ChannelConnectionView | null;
  trips: { total: number; selling: number; needsAttention: number };
  steps: string[];
}) {
  const [state, connect] = useActionState(connectRezdyAction, IDLE);
  const [autoState, setAuto] = useActionState(rezdyAutoPublishAction, IDLE);

  if (!configured) {
    return (
      <div className="adm-card adm-empty">
        <p className="ds-body-sm adm-empty__title">The Rezdy connection is coming soon.</p>
        <p className="ds-body-sm adm-empty__body">There is nothing for you to set up yet. We will tell you when you can connect your Rezdy account.</p>
      </div>
    );
  }

  if (!connection) {
    return (
      <form action={connect} className="adm-card rl-form">
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Your Rezdy booking address</span>
          <input name="address" className="rl-input" placeholder="yourcompany.rezdy.com" autoComplete="off" spellCheck={false} required />
          <span className="ds-micro rl-field__hint">The address of your Rezdy booking page, or any trip on it.</span>
        </label>
        <ActionNotice state={state} />
        <div className="rl-actions">
          <PendingButton pending="Looking up Rezdy…">Connect Rezdy</PendingButton>
        </div>
      </form>
    );
  }

  const name = connection.displayName ?? connection.accountKey;
  return (
    <div className="adm-card rl-stack">
      <div className="rl-conn">
        <span className={`rl-conn__dot${connection.status === "CONNECTED" ? "" : " is-warn"}`} aria-hidden />
        <div className="rl-conn__body">
          <p className="ds-body rl-conn__title">
            {connection.status === "CONNECTED" ? `Connected to ${name}` : connection.status === "WAITING" ? `Found ${name} on Rezdy` : `${name} needs attention`}
          </p>
          <p className="ds-caption rl-muted">
            {connection.status === "CONNECTED"
              ? `${trips.total} ${trips.total === 1 ? "trip" : "trips"} from ${connection.accountKey}.rezdy.com, ${trips.selling} selling on Bluepass.${connection.lastSynced ? ` Checked ${connection.lastSynced}.` : ""}`
              : connection.status === "WAITING"
                ? "Rezdy is not sharing any trips with Bluepass yet. Three steps in Rezdy and they appear here on their own:"
                : connection.lastError ?? "Rezdy stopped answering for this account."}
          </p>
          {connection.status === "CONNECTED" && trips.needsAttention > 0 ? (
            <p className="ds-caption rl-warn">{trips.needsAttention} {trips.needsAttention === 1 ? "trip needs" : "trips need"} a change in Rezdy before {trips.needsAttention === 1 ? "it sells" : "they sell"}. See Trips.</p>
          ) : null}
        </div>
      </div>
      {connection.status === "WAITING" ? <Steps steps={steps} /> : null}
      <ActionButton action={syncRezdyAction} label={connection.status === "CONNECTED" ? "Sync now" : "Check again"} pending="Checking Rezdy…" />
      {connection.status === "CONNECTED" ? (
        <form action={setAuto} className="rl-stack rl-stack--tight">
          <label className="rl-switch">
            <input type="checkbox" name="autoPublish" defaultChecked={connection.autoPublish} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
            <span className="ds-body-sm">Sell new Rezdy trips here as soon as I share them</span>
            <span className="ds-micro rl-field__hint">Off: new trips wait on the Trips page until you switch each one on.</span>
          </label>
          <ActionNotice state={autoState} />
        </form>
      ) : null}
      <Disconnect
        action={disconnectRezdyAction}
        name="Rezdy"
        what="Your Rezdy trips stop selling on Bluepass. Bookings already made stand, and nothing changes in Rezdy."
      />
    </div>
  );
}

/**
 * FareHarbor, from the operator's side. FareHarbor gives Bluepass no data feed, so the
 * connection is the booking link FareHarbor makes with Bluepass as the affiliate.
 */
export function FareHarborConnection({
  ready,
  connection,
  trips,
  steps,
  requestUrl,
}: {
  ready: boolean;
  connection: ChannelConnectionView | null;
  trips: number;
  steps: string[];
  requestUrl: string;
}) {
  const [state, connect] = useActionState(connectFareHarborAction, IDLE);
  const [adding, setAdding] = useState(false);

  if (!ready) {
    return (
      <div className="adm-card adm-empty">
        <p className="ds-body-sm adm-empty__title">The FareHarbor connection is coming soon.</p>
        <p className="ds-body-sm adm-empty__body">There is nothing for you to set up yet. We will tell you when you can connect your FareHarbor account.</p>
      </div>
    );
  }

  const tagged = connection?.status === "CONNECTED";
  return (
    <div className="adm-card rl-stack">
      {connection ? (
        <div className="rl-conn">
          <span className={`rl-conn__dot${tagged ? "" : " is-warn"}`} aria-hidden />
          <div className="rl-conn__body">
            <p className="ds-body rl-conn__title">{tagged ? `Connected to ${connection.accountKey} on FareHarbor` : `Found ${connection.accountKey} on FareHarbor`}</p>
            <p className="ds-caption rl-muted">
              {tagged
                ? `${trips} ${trips === 1 ? "trip books" : "trips book"} through your FareHarbor checkout, tagged as Bluepass's. FareHarbor takes the payment.`
                : "The link you pasted is not tagged for Bluepass yet:"}
            </p>
          </div>
        </div>
      ) : (
        <p className="ds-body-sm rl-muted">Travellers book on your own FareHarbor checkout, opened over the Bluepass page and tagged as Bluepass&rsquo;s. FareHarbor takes the payment and you handle changes there, as you do now.</p>
      )}

      {!tagged ? (
        <>
          <Steps steps={steps} />
          <p className="ds-caption rl-muted"><a href={requestUrl} target="_blank" rel="noreferrer">FareHarbor&rsquo;s New Affiliate Request form ›</a></p>
          <form action={connect} className="rl-form">
            <ZoneField />
            <label className="rl-field">
              <span className="ds-micro rl-field__label">Booking link with Bluepass as the affiliate</span>
              <input name="link" className="rl-input" placeholder="https://fareharbor.com/embeds/book/yourcompany/items/…" autoComplete="off" spellCheck={false} required />
            </label>
            <ActionNotice state={state} />
            <div className="rl-actions">
              <PendingButton pending="Checking…">Connect FareHarbor</PendingButton>
            </div>
          </form>
        </>
      ) : adding ? (
        <AddFareHarborTrip onDone={() => setAdding(false)} />
      ) : (
        <div className="rl-actions">
          <button type="button" className="rl-btn rl-btn--primary" onClick={() => setAdding(true)}>Add a FareHarbor trip</button>
        </div>
      )}

      {connection ? (
        <Disconnect action={disconnectFareHarborAction} name="FareHarbor" what="Your FareHarbor trips stop selling on Bluepass. Nothing changes in FareHarbor." />
      ) : null}
    </div>
  );
}

/** A new trip that books on FareHarbor: its link, a name, a few lines and a photo. */
function AddFareHarborTrip({ onDone }: { onDone: () => void }) {
  const [state, add] = useActionState(addFareHarborTripAction, IDLE);
  if (state.status === "done") {
    return (
      <div className="rl-stack">
        <ActionNotice state={state} />
        <div className="rl-actions">
          <button type="button" className="rl-btn rl-btn--secondary" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }
  return (
    <form action={add} className="rl-form">
      <ZoneField />
      <p className="ds-body-sm rl-form__lede">FareHarbor keeps the dates, prices and checkout. Bluepass needs what a traveller reads before they choose.</p>
      <label className="rl-field">
        <span className="ds-micro rl-field__label">This trip&rsquo;s FareHarbor link, tagged for Bluepass</span>
        <input name="link" className="rl-input" placeholder="https://fareharbor.com/embeds/book/yourcompany/items/12345/?asn=…" required />
      </label>
      <div className="rl-grid">
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Trip name</span>
          <input name="title" className="rl-input" maxLength={160} required />
        </label>
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Where</span>
          <input name="region" className="rl-input" placeholder="Bridgetown, Barbados" maxLength={120} required />
        </label>
      </div>
      <label className="rl-field">
        <span className="ds-micro rl-field__label">What travellers should know</span>
        <textarea name="description" className="rl-input rl-input--area" rows={4} maxLength={4000} required />
      </label>
      <label className="rl-field">
        <span className="ds-micro rl-field__label">Photo address</span>
        <input name="heroImageUrl" className="rl-input" placeholder="https://…" />
      </label>
      <div className="rl-grid">
        <label className="rl-field">
          <span className="ds-micro rl-field__label">From price per guest</span>
          <input name="priceFrom" className="rl-input" inputMode="decimal" placeholder="129" />
        </label>
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Currency</span>
          <input name="currency" className="rl-input rl-input--narrow" defaultValue="AUD" maxLength={3} />
        </label>
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Hours</span>
          <input name="hours" className="rl-input rl-input--narrow" inputMode="decimal" placeholder="3" />
        </label>
      </div>
      <label className="rl-field">
        <span className="ds-micro rl-field__label">Meeting point</span>
        <input name="meetingPoint" className="rl-input" maxLength={300} />
      </label>
      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton pending="Adding…">Add trip</PendingButton>
        <button type="button" className="rl-btn rl-btn--quiet" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
