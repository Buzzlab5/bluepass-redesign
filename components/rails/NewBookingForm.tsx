"use client";

import { useActionState, useMemo, useState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import PendingButton from "@/components/rails/PendingButton";
import { createOperatorBookingAction, type RailsActionState } from "@/app/operator/rails-actions";
import { formatLocalTime } from "@/lib/services/rails/format";
import { formatMoney } from "@/lib/services/rails/money";

const IDLE: RailsActionState = { status: "idle" };

export type NewBookingDeparture = { at: number; localTime: string; seatsLeft: number; capacity: number; closed: boolean };
export type NewBookingRate = { id: string; label: string; amountCents: number; perGuest: boolean };

/**
 * A booking taken over the phone or at the counter. Built for speed with a caller
 * on the line: departure, how many, a name, done. Price fills itself in from the
 * rate card and can be overwritten when the operator has quoted something else.
 */
export default function NewBookingForm({
  listingId,
  departures,
  rates,
  currency,
  preselect,
}: {
  listingId: string;
  departures: NewBookingDeparture[];
  rates: NewBookingRate[];
  currency: string;
  preselect: number | null;
}) {
  const [state, formAction] = useActionState(createOperatorBookingAction, IDLE);
  const open = departures.filter((d) => d.seatsLeft > 0);
  const [at, setAt] = useState<number | null>(preselect ?? (open.length === 1 ? open[0].at : null));
  const [qty, setQty] = useState<Record<string, number>>(() => {
    const first = rates.find((r) => r.perGuest);
    return first ? { [first.id]: 2 } : {};
  });
  const [guests, setGuests] = useState(2);
  const [total, setTotal] = useState<string>("");
  const [payment, setPayment] = useState<"collect" | "paid">("collect");

  const flatChosen = rates.some((r) => !r.perGuest && (qty[r.id] ?? 0) > 0);
  const perGuestSeats = rates.filter((r) => r.perGuest).reduce((n, r) => n + (qty[r.id] ?? 0), 0);
  const seats = rates.length === 0 ? guests : flatChosen ? Math.max(guests, perGuestSeats) : perGuestSeats;
  const computed = useMemo(() => rates.reduce((sum, r) => sum + r.amountCents * (qty[r.id] ?? 0), 0), [rates, qty]);
  const chosen = departures.find((d) => d.at === at);
  const tooMany = chosen ? seats > chosen.seatsLeft : false;

  const step = (id: string, delta: number, max = 99) =>
    setQty((cur) => ({ ...cur, [id]: Math.min(max, Math.max(0, (cur[id] ?? 0) + delta)) }));

  return (
    <form action={formAction} className="rl-stack">
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="at" value={at ?? ""} />

      <fieldset className="rl-field">
        <legend className="ds-micro rl-field__label">Departure</legend>
        {departures.length === 0 ? (
          <p className="ds-body-sm rl-muted">No departures on this date.</p>
        ) : (
          <div className="rl-slots">
            {departures.map((d) => (
              <button
                key={d.at}
                type="button"
                disabled={d.seatsLeft === 0}
                className={`rl-slot${at === d.at ? " is-on" : ""}`}
                onClick={() => setAt(d.at)}
                aria-pressed={at === d.at}
              >
                <span className="ds-body">{formatLocalTime(d.localTime)}</span>
                <span className="ds-micro">{d.seatsLeft === 0 ? "Full" : `${d.seatsLeft} of ${d.capacity} left`}{d.closed ? " · closed online" : ""}</span>
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="rl-field">
        <legend className="ds-micro rl-field__label">Guests</legend>
        {rates.length === 0 ? (
          <Stepper label="Guests" value={guests} onChange={setGuests} name="guests" />
        ) : (
          <div className="rl-steppers">
            {rates.map((r) =>
              r.perGuest ? (
                <Stepper
                  key={r.id}
                  label={r.label}
                  hint={formatMoney(r.amountCents, currency)}
                  value={qty[r.id] ?? 0}
                  onChange={(v) => setQty((cur) => ({ ...cur, [r.id]: v }))}
                  name={`qty:${r.id}`}
                />
              ) : (
                <label key={r.id} className="rl-switch">
                  <input type="checkbox" name={`qty:${r.id}`} value="1" checked={(qty[r.id] ?? 0) > 0} onChange={(e) => step(r.id, e.target.checked ? 1 : -1, 1)} />
                  <span className="ds-body-sm">{r.label}</span>
                  <span className="ds-micro rl-field__hint">{formatMoney(r.amountCents, currency)} per booking</span>
                </label>
              ),
            )}
            {flatChosen ? <Stepper label="People coming" value={guests} onChange={setGuests} name="guests" /> : null}
          </div>
        )}
        {tooMany ? <span className="ds-micro rl-field__hint rl-warn">Only {chosen?.seatsLeft} seats left on this departure.</span> : null}
      </fieldset>

      <div className="rl-grid">
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Lead guest</span>
          <input name="leadName" required autoComplete="off" placeholder="Full name" className="rl-input" />
        </label>
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Phone</span>
          <input name="leadPhone" type="tel" autoComplete="off" placeholder="+61 4…" className="rl-input" />
        </label>
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Email</span>
          <input name="leadEmail" type="email" autoComplete="off" placeholder="For the confirmation" className="rl-input" />
        </label>
      </div>

      <div className="rl-grid">
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Total</span>
          <span className="rl-input rl-input--affix">
            <span className="ds-caption rl-input__prefix">{currency}</span>
            <input
              name="total"
              inputMode="decimal"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder={rates.length ? (computed / 100).toString() : "0"}
            />
          </span>
          <span className="ds-micro rl-field__hint">{total ? "Your price, instead of the rate card." : rates.length ? `From your prices: ${formatMoney(computed, currency)}` : "Optional"}</span>
        </label>
        <fieldset className="rl-field">
          <legend className="ds-micro rl-field__label">Payment</legend>
          <div className="rl-segment" role="radiogroup">
            {[
              { value: "collect", label: "Collect on the day" },
              { value: "paid", label: "Already paid" },
            ].map((o) => (
              <label key={o.value} className={`rl-segment__option${payment === o.value ? " is-on" : ""}`}>
                <input type="radio" name="payment" value={o.value} checked={payment === o.value} onChange={() => setPayment(o.value as "collect" | "paid")} />
                <span className="ds-body-sm">{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <label className="rl-field">
        <span className="ds-micro rl-field__label">Notes</span>
        <input name="notes" placeholder="Allergies, a birthday, pick-up from the hotel" maxLength={1000} className="rl-input" />
      </label>

      <label className="rl-switch">
        <input type="checkbox" name="sendConfirmation" defaultChecked />
        <span className="ds-body-sm">Email them a confirmation</span>
        <span className="ds-micro rl-field__hint">Only if you added an email.</span>
      </label>
      <label className="rl-switch">
        <input type="checkbox" name="sendWhatsApp" />
        <span className="ds-body-sm">WhatsApp them their booking and a reminder</span>
        <span className="ds-micro rl-field__hint">Ask them first. A local number is read as one from your country.</span>
      </label>

      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton disabled={!at || seats < 1 || tooMany} pending="Booking…">
          {seats > 0 ? `Book ${seats} ${seats === 1 ? "guest" : "guests"}` : "Book"}
        </PendingButton>
      </div>
    </form>
  );
}

function Stepper({ label, hint, value, onChange, name }: { label: string; hint?: string; value: number; onChange: (v: number) => void; name: string }) {
  return (
    <div className="rl-stepper">
      <span className="rl-stepper__label">
        <span className="ds-body-sm">{label}</span>
        {hint ? <span className="ds-micro rl-muted">{hint}</span> : null}
      </span>
      <span className="rl-stepper__control">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} aria-label={`Fewer ${label}`}>−</button>
        <output className="ds-body" aria-live="polite">{value}</output>
        <button type="button" onClick={() => onChange(Math.min(500, value + 1))} aria-label={`More ${label}`}>+</button>
      </span>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
