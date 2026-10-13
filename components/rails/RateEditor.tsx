"use client";

import { useActionState, useState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import InlineAction from "@/components/rails/InlineAction";
import PendingButton from "@/components/rails/PendingButton";
import { DateField, NumberField } from "@/components/rails/ScheduleEditor";
import { removeRateAction, saveRateAction, type RailsActionState } from "@/app/operator/rails-actions";
import { formatMoney } from "@/lib/services/rails/money";

const IDLE: RailsActionState = { status: "idle" };

export type RateRow = {
  id: string;
  label: string;
  amountCents: number;
  currency: string;
  perGuest: boolean;
  minAge: number | null;
  maxAge: number | null;
  seasonStart: string | null;
  seasonEnd: string | null;
  isDefault: boolean;
};

function ages(r: RateRow) {
  if (r.minAge !== null && r.maxAge !== null) return `Ages ${r.minAge} to ${r.maxAge}`;
  if (r.minAge !== null) return `Ages ${r.minAge} and up`;
  if (r.maxAge !== null) return `Up to age ${r.maxAge}`;
  return null;
}

/**
 * What a seat costs. Most operators need one price; the form opens on exactly that
 * and keeps ages and seasons out of the way until someone asks for them.
 */
export default function RateEditor({ listingId, rates, currency }: { listingId: string; rates: RateRow[]; currency: string }) {
  const [editing, setEditing] = useState<string | "new" | null>(rates.length === 0 ? "new" : null);

  return (
    <div className="rl-stack">
      {rates.length > 0 ? (
        <ul className="rl-rows">
          {rates.map((r) =>
            editing === r.id ? (
              <li key={r.id} className="rl-rows__item rl-rows__item--open">
                <RateForm listingId={listingId} rate={r} currency={currency} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={r.id} className="rl-rows__item">
                <div className="rl-rows__main">
                  <span className="ds-body rl-rows__title">
                    {r.label}
                    {r.isDefault ? <span className="ds-micro rl-tag">Default</span> : null}
                  </span>
                  <span className="ds-caption rl-rows__meta">
                    {[ages(r), r.seasonStart || r.seasonEnd ? `${r.seasonStart ?? "Now"} to ${r.seasonEnd ?? "ongoing"}` : null]
                      .filter(Boolean)
                      .join(" · ") || (r.perGuest ? "Per guest" : "Per booking, whatever the group size")}
                  </span>
                </div>
                <span className="ds-body rl-rows__money">
                  {formatMoney(r.amountCents, r.currency)}
                  <span className="ds-micro rl-rows__unit">{r.perGuest ? "per guest" : "per booking"}</span>
                </span>
                <div className="rl-rows__actions">
                  <button type="button" className="rl-btn rl-btn--quiet rl-btn--sm" onClick={() => setEditing(r.id)}>Edit</button>
                  <InlineAction action={removeRateAction.bind(null, listingId, r.id)} label="Remove" pending="Removing…" />
                </div>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {editing === "new" ? (
        <RateForm listingId={listingId} currency={currency} onDone={() => setEditing(null)} first={rates.length === 0} />
      ) : editing === null ? (
        <div className="rl-actions">
          <button type="button" className="rl-btn rl-btn--secondary" onClick={() => setEditing("new")}>
            {rates.length === 0 ? "Set a price" : "Add another price"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RateForm({ listingId, rate, currency, onDone, first }: { listingId: string; rate?: RateRow; currency: string; onDone: () => void; first?: boolean }) {
  const [state, formAction] = useActionState(saveRateAction.bind(null, listingId, rate?.id ?? null), IDLE);
  const [per, setPer] = useState(rate?.perGuest === false ? "booking" : "guest");
  const [more, setMore] = useState(Boolean(rate && (rate.minAge !== null || rate.maxAge !== null || rate.seasonStart || rate.seasonEnd)));
  const invalid = (f: string) => state.status === "error" && state.field === f;

  if (state.status === "done") {
    return (
      <div className="rl-saved">
        <ActionNotice state={state} />
        <button type="button" className="rl-btn rl-btn--secondary rl-btn--sm" onClick={onDone}>Done</button>
      </div>
    );
  }

  return (
    <form action={formAction} className="rl-form">
      <div className="rl-grid">
        <label className={`rl-field${invalid("label") ? " is-invalid" : ""}`}>
          <span className="ds-micro rl-field__label">Name</span>
          <input name="label" defaultValue={rate?.label ?? (first ? "Adult" : "")} placeholder="Adult, Child, Private charter" className="rl-input" required maxLength={60} />
        </label>
        <label className={`rl-field${invalid("amount") ? " is-invalid" : ""}`}>
          <span className="ds-micro rl-field__label">Price</span>
          <span className="rl-input rl-input--affix">
            <span className="ds-caption rl-input__prefix">{currency}</span>
            <input name="amount" defaultValue={rate ? (rate.amountCents / 100).toString() : ""} inputMode="decimal" placeholder="189" required />
          </span>
        </label>
      </div>

      <div className="rl-segment" role="radiogroup" aria-label="Charged">
        {[
          { value: "guest", label: "Per guest" },
          { value: "booking", label: "Per booking" },
        ].map((o) => (
          <label key={o.value} className={`rl-segment__option${per === o.value ? " is-on" : ""}`}>
            <input type="radio" name="per" value={o.value} checked={per === o.value} onChange={() => setPer(o.value)} />
            <span className="ds-body-sm">{o.label}</span>
          </label>
        ))}
      </div>
      <span className="ds-micro rl-field__hint">
        {per === "guest" ? "Each guest pays this." : "Charged once for the whole group, like a private charter."}
      </span>

      {more ? (
        <div className="rl-grid">
          <NumberField label="From age" name="minAge" defaultValue={rate?.minAge ?? ""} min={0} />
          <NumberField label="To age" name="maxAge" defaultValue={rate?.maxAge ?? ""} min={0} invalid={invalid("maxAge")} />
          <DateField label="Only from" name="seasonStart" defaultValue={rate?.seasonStart ?? ""} />
          <DateField label="Until" name="seasonEnd" defaultValue={rate?.seasonEnd ?? ""} invalid={invalid("seasonEnd")} />
        </div>
      ) : (
        <button type="button" className="rl-btn rl-btn--quiet rl-btn--sm rl-self-start" onClick={() => setMore(true)}>
          + Age band or season
        </button>
      )}

      <label className="rl-switch">
        <input type="checkbox" name="isDefault" defaultChecked={rate?.isDefault ?? first} />
        <span className="ds-body-sm">Default price</span>
        <span className="ds-micro rl-field__hint">Quoted when someone asks &ldquo;how much for two&rdquo; without saying ages.</span>
      </label>

      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton>{rate ? "Save price" : "Add price"}</PendingButton>
        {!first ? <button type="button" className="rl-btn rl-btn--quiet" onClick={onDone}>Cancel</button> : null}
      </div>
    </form>
  );
}
