"use client";

import { useActionState, useState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import PendingButton from "@/components/rails/PendingButton";
import {
  linkFareHarborTripAction,
  setChannelTripLiveAction,
  unlinkFareHarborTripAction,
  type RailsActionState,
} from "@/app/operator/rails-actions";

const IDLE: RailsActionState = { status: "idle" };

/** Selling on Bluepass or not. The trip itself lives in the operator's own system either way. */
export function ChannelVisibility({ listingId, live, from }: { listingId: string; live: boolean; from: string }) {
  const [state, action] = useActionState(setChannelTripLiveAction.bind(null, listingId, !live), IDLE);
  return (
    <form action={action} className="adm-card rl-stack">
      <div className="rl-conn">
        <span className={`rl-conn__dot${live ? "" : " is-off"}`} aria-hidden />
        <div className="rl-conn__body">
          <p className="ds-body rl-conn__title">{live ? "Selling on Bluepass" : "Hidden from Bluepass"}</p>
          <p className="ds-caption rl-muted">
            {live
              ? `Travellers can find and book it on Bluepass and through your link. Hiding it here changes nothing in ${from}.`
              : `It stays in ${from}. Switch it on to sell it on Bluepass too.`}
          </p>
        </div>
      </div>
      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton variant={live ? "secondary" : "primary"} pending={live ? "Hiding…" : "Switching on…"}>
          {live ? "Hide from Bluepass" : "Sell on Bluepass"}
        </PendingButton>
      </div>
    </form>
  );
}

/** The trip's FareHarbor link: pasted to start booking through FareHarbor, or replaced later. */
export function FareHarborLinkForm({ listingId, current, lede }: { listingId: string; current: string | null; lede: string }) {
  const [state, action] = useActionState(linkFareHarborTripAction.bind(null, listingId), IDLE);
  return (
    <form action={action} className="adm-card rl-form">
      <p className="ds-body-sm rl-form__lede">{lede}</p>
      <label className="rl-field">
        <span className="ds-micro rl-field__label">This trip&rsquo;s FareHarbor link, tagged for Bluepass</span>
        <input name="link" className="rl-input" defaultValue={current ?? ""} placeholder="https://fareharbor.com/embeds/book/yourcompany/items/12345/?asn=…" required />
      </label>
      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton variant={current ? "secondary" : "primary"} pending="Checking…">{current ? "Save link" : "Book through FareHarbor"}</PendingButton>
      </div>
    </form>
  );
}

export function FareHarborUnlink({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(unlinkFareHarborTripAction.bind(null, listingId), IDLE);
  if (!open) {
    return <button type="button" className="rl-btn rl-btn--quiet rl-self-start" onClick={() => setOpen(true)}>Stop booking through FareHarbor…</button>;
  }
  return (
    <form action={action} className="rl-danger rl-form">
      <p className="ds-body-sm">The trip stops selling until you give it a schedule and a price on Bluepass&rsquo;s own calendar. Nothing changes in FareHarbor.</p>
      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton danger pending="Switching…">Stop booking through FareHarbor</PendingButton>
        <button type="button" className="rl-btn rl-btn--quiet" onClick={() => setOpen(false)}>Keep it</button>
      </div>
    </form>
  );
}
