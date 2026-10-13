"use client";

import { useActionState, useState } from "react";
import Notice from "@/components/auth/Notice";
import Field from "@/components/auth/Field";
import Button from "@/components/ui/Button";
import StatusPill from "@/components/admin/StatusPill";
import {
  deleteTripAction,
  saveTripAction,
  unpublishTripAction,
  type TripActionState,
} from "@/app/operator/trips/actions";
import {
  TRIP_CATEGORIES,
  TRIP_CURRENCIES,
  TRIP_TIME_ZONES,
  WEEKDAYS,
  type TripEditorValues,
} from "@/lib/services/operator/native-trip-editor";

const IDLE: TripActionState = { status: "idle" };

type Props = {
  tripId: string | null;
  initial: TripEditorValues;
  status: "DRAFT" | "PUBLISHED" | null;
  /** A message carried over from the save that created this trip. */
  notice?: string;
};

/**
 * One trip: its details, tickets and prices, weekly departure times with seats, and blocked dates.
 * Built to be filled in on a phone: single column, large tap targets, no table. The whole state
 * travels to the server as one JSON field (see saveTripAction); Kai does the strict checking.
 */
export default function TripEditor({ tripId, initial, status, notice }: Props) {
  const [values, setValues] = useState<TripEditorValues>(initial);
  const [saveState, saveAction, saving] = useActionState(saveTripAction.bind(null, tripId), IDLE);
  const [unpublishState, unpublishAction, unpublishing] = useActionState(
    unpublishTripAction.bind(null, tripId ?? ""),
    IDLE,
  );
  const [deleteState, deleteAction, deleting] = useActionState(deleteTripAction.bind(null, tripId ?? ""), IDLE);
  const busy = saving || unpublishing || deleting;

  const set = <K extends keyof TripEditorValues>(key: K) => (value: TripEditorValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const updateRow = <K extends "tickets" | "schedules" | "blackouts">(key: K, index: number, patch: Partial<TripEditorValues[K][number]>) =>
    setValues((current) => ({
      ...current,
      [key]: current[key].map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    }));

  const removeRow = (key: "tickets" | "schedules" | "blackouts", index: number) =>
    setValues((current) => ({ ...current, [key]: current[key].filter((_, rowIndex) => rowIndex !== index) }));

  const toggleDay = (index: number, day: number) =>
    setValues((current) => ({
      ...current,
      schedules: current.schedules.map((row, rowIndex) =>
        rowIndex === index ? { ...row, days: row.days.includes(day) ? row.days.filter((d) => d !== day) : [...row.days, day] } : row,
      ),
    }));

  const message = saveState.status !== "idle" ? saveState : unpublishState.status !== "idle" ? unpublishState : deleteState;

  return (
    <>
    <form action={saveAction} className="adm-form">
      <input type="hidden" name="editor" value={JSON.stringify(values)} />

      {notice && message.status === "idle" ? <Notice tone="success">{notice}</Notice> : null}
      {message.status === "error" ? <Notice tone="error">{message.message}</Notice> : null}
      {message.status === "done" ? <Notice tone="success">{message.message}</Notice> : null}

      {status ? (
        <div className="adm-trip-status">
          <StatusPill tone={status === "PUBLISHED" ? "good" : "warn"}>{status === "PUBLISHED" ? "On sale" : "Draft"}</StatusPill>
          <span className="ds-body-sm">
            {status === "PUBLISHED" ? "Travellers can see and book this trip." : "Travellers cannot see this trip yet."}
          </span>
        </div>
      ) : null}

      <section className="adm-form__section">
        <h2 className="ds-headline adm-form__legend">The trip</h2>
        <div className="adm-form__grid">
          <div className="adm-form__row adm-form__row--wide">
            <Field label="Name" value={values.title} onChange={set("title")} placeholder="Sunset catamaran" autoComplete="off" disabled={busy} />
          </div>

          <div className="adm-form__row">
            <SelectField label="Category" value={values.category} onChange={set("category")} disabled={busy}>
              {TRIP_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="adm-form__row">
            <Field label="Where it runs" value={values.region} onChange={set("region")} placeholder="Barbados West Coast" autoComplete="off" disabled={busy} />
          </div>
          <div className="adm-form__row">
            <Field
              label="How long (hours)"
              value={values.durationHours}
              onChange={set("durationHours")}
              inputMode="numeric"
              placeholder="2.5"
              autoComplete="off"
              disabled={busy}
            />
          </div>
          <div className="adm-form__row">
            <Field label="Meeting point" value={values.meetingPoint} onChange={set("meetingPoint")} placeholder="The Careenage, Bridgetown" autoComplete="off" disabled={busy} />
          </div>

          <div className="adm-form__row adm-form__row--wide">
            <label className="afield">
              <span className="afield__top">
                <span className="ds-micro afield__label">Description</span>
              </span>
              <span className="afield__well">
                <textarea
                  value={values.description}
                  onChange={(event) => set("description")(event.target.value)}
                  rows={5}
                  disabled={busy}
                  className="afield__input adm-textarea"
                  placeholder="What travellers will do, what is included, what to bring."
                />
              </span>
            </label>
          </div>
        </div>
      </section>

      <section className="adm-form__section">
        <h2 className="ds-headline adm-form__legend">Photos</h2>
        <p className="ds-body-sm adm-form__help">Paste a link to each photo. The first one is the cover. Links must start with https://.</p>
        <ul className="adm-rows">
          {values.photoUrls.map((url, index) => (
            <li className="adm-rows__item" key={index}>
              <Field
                label={index === 0 ? "Cover photo" : `Photo ${index + 1}`}
                value={url}
                onChange={(next) => set("photoUrls")(values.photoUrls.map((current, i) => (i === index ? next : current)))}
                inputMode="url"
                placeholder="https://"
                autoComplete="off"
                disabled={busy}
              />
              {values.photoUrls.length > 1 ? (
                <RemoveButton label={`Remove photo ${index + 1}`} disabled={busy} onClick={() => set("photoUrls")(values.photoUrls.filter((_, i) => i !== index))} />
              ) : null}
            </li>
          ))}
        </ul>
        {values.photoUrls.length < 8 ? (
          <button type="button" className="alink-btn ds-body-sm" onClick={() => set("photoUrls")([...values.photoUrls, ""])} disabled={busy}>
            + Add a photo
          </button>
        ) : null}
      </section>

      <section className="adm-form__section">
        <h2 className="ds-headline adm-form__legend">Tickets and prices</h2>
        <div className="adm-form__grid">
          <div className="adm-form__row">
            <SelectField label="Currency" value={values.currency} onChange={set("currency")} disabled={busy}>
              {TRIP_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="adm-form__row">
            <SelectField label="Time zone" value={values.timeZone} onChange={set("timeZone")} disabled={busy}>
              {TRIP_TIME_ZONES.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </SelectField>
          </div>
        </div>
        <ul className="adm-rows">
          {values.tickets.map((ticket, index) => (
            <li className="adm-rows__item adm-rows__item--ticket" key={index}>
              <Field label="Name" value={ticket.label} onChange={(label) => updateRow("tickets", index, { label })} placeholder="Adult" autoComplete="off" disabled={busy} />
              <Field label={`Price (${values.currency})`} value={ticket.price} onChange={(price) => updateRow("tickets", index, { price })} inputMode="numeric" placeholder="95" autoComplete="off" disabled={busy} />
              <SelectField label="Type" value={ticket.kind} onChange={(kind) => updateRow("tickets", index, { kind: kind as "TICKET" | "EXTRA" })} disabled={busy}>
                <option value="TICKET">Ticket (needs a seat)</option>
                <option value="EXTRA">Extra (add-on)</option>
              </SelectField>
              {values.tickets.length > 1 ? (
                <RemoveButton label={`Remove ${ticket.label || "ticket"}`} disabled={busy} onClick={() => removeRow("tickets", index)} />
              ) : null}
            </li>
          ))}
        </ul>
        <button type="button" className="alink-btn ds-body-sm" onClick={() => set("tickets")([...values.tickets, { label: "", price: "", kind: "TICKET" }])} disabled={busy}>
          + Add a ticket or extra
        </button>
      </section>

      <section className="adm-form__section">
        <h2 className="ds-headline adm-form__legend">Departure times</h2>
        <p className="ds-body-sm adm-form__help">Pick the days the trip runs, the start time and how many seats it has. Add a row for each different time.</p>
        <ul className="adm-rows">
          {values.schedules.map((schedule, index) => (
            <li className="adm-rows__item adm-rows__item--schedule" key={index}>
              <div className="adm-days" role="group" aria-label="Days it runs">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    className={`adm-days__day${schedule.days.includes(day.value) ? " is-on" : ""}`}
                    aria-pressed={schedule.days.includes(day.value)}
                    onClick={() => toggleDay(index, day.value)}
                    disabled={busy}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <div className="adm-form__grid">
                <Field label="Start time" value={schedule.time} onChange={(time) => updateRow("schedules", index, { time })} placeholder="09:00" autoComplete="off" disabled={busy} />
                <Field label="Seats" value={schedule.seats} onChange={(seats) => updateRow("schedules", index, { seats })} inputMode="numeric" placeholder="12" autoComplete="off" disabled={busy} />
                <Field label="From (optional)" value={schedule.validFrom} onChange={(validFrom) => updateRow("schedules", index, { validFrom })} placeholder="2026-11-01" hint="Leave empty to start now" autoComplete="off" disabled={busy} />
                <Field label="Until (optional)" value={schedule.validUntil} onChange={(validUntil) => updateRow("schedules", index, { validUntil })} placeholder="2027-04-30" hint="Leave empty for no end" autoComplete="off" disabled={busy} />
              </div>
              {values.schedules.length > 1 ? (
                <RemoveButton label="Remove this departure time" disabled={busy} onClick={() => removeRow("schedules", index)} />
              ) : null}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="alink-btn ds-body-sm"
          onClick={() => set("schedules")([...values.schedules, { days: [], time: "09:00", seats: "", validFrom: "", validUntil: "" }])}
          disabled={busy}
        >
          + Add another departure time
        </button>
      </section>

      <section className="adm-form__section">
        <h2 className="ds-headline adm-form__legend">Days you are closed</h2>
        <p className="ds-body-sm adm-form__help">Holidays, maintenance, private charters. No one can book these dates. Use the form 2026-12-25.</p>
        {values.blackouts.length > 0 ? (
          <ul className="adm-rows">
            {values.blackouts.map((blackout, index) => (
              <li className="adm-rows__item adm-rows__item--blackout" key={index}>
                <Field label="From" value={blackout.fromDate} onChange={(fromDate) => updateRow("blackouts", index, { fromDate })} placeholder="2026-12-24" autoComplete="off" disabled={busy} />
                <Field label="To" value={blackout.toDate} onChange={(toDate) => updateRow("blackouts", index, { toDate })} placeholder="2026-12-26" hint="Same day if empty" autoComplete="off" disabled={busy} />
                <Field label="Reason (optional)" value={blackout.reason} onChange={(reason) => updateRow("blackouts", index, { reason })} placeholder="Christmas" autoComplete="off" disabled={busy} />
                <RemoveButton label="Remove this closed period" disabled={busy} onClick={() => removeRow("blackouts", index)} />
              </li>
            ))}
          </ul>
        ) : null}
        <button type="button" className="alink-btn ds-body-sm" onClick={() => set("blackouts")([...values.blackouts, { fromDate: "", toDate: "", reason: "" }])} disabled={busy}>
          + Add closed days
        </button>
      </section>

      <div className="adm-form__submit">
        <Button type="submit" variant="secondary" large magnetic={false} name="intent" value="save" disabled={busy}>
          {saving ? "Saving…" : "Save draft"}
        </Button>
        <Button type="submit" variant="primary" large magnetic={false} name="intent" value="publish" disabled={busy}>
          {saving ? "Saving…" : status === "PUBLISHED" ? "Save changes" : "Save and publish"}
        </Button>
      </div>

    </form>

    {tripId ? (
      <div className="adm-form__submit adm-trip-danger">
        {status === "PUBLISHED" ? (
          <form action={unpublishAction}>
            <Button type="submit" variant="secondary" magnetic={false} disabled={busy}>
              {unpublishing ? "Unpublishing…" : "Unpublish"}
            </Button>
          </form>
        ) : null}
        <form action={deleteAction}>
          <Button type="submit" variant="secondary" magnetic={false} disabled={busy}>
            {deleting ? "Deleting…" : "Delete trip"}
          </Button>
        </form>
        <p className="ds-micro adm-form__help">A trip that has bookings cannot be deleted. Unpublish it instead.</p>
      </div>
    ) : null}
    </>
  );
}

function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="alink-btn alink-btn--quiet ds-micro adm-rows__remove" onClick={onClick} disabled={disabled} aria-label={label}>
      Remove
    </button>
  );
}

function SelectField({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="afield">
      <span className="afield__top">
        <span className="ds-micro afield__label">{label}</span>
      </span>
      <span className="afield__well">
        <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="afield__input">
          {children}
        </select>
      </span>
    </label>
  );
}
