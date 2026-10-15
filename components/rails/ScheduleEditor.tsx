"use client";

import { useActionState, useState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import InlineAction from "@/components/rails/InlineAction";
import PendingButton from "@/components/rails/PendingButton";
import {
  addOneOffAction,
  removeScheduleAction,
  saveScheduleAction,
  type RailsActionState,
} from "@/app/operator/rails-actions";
import {
  describeWeekdays,
  formatLocalTime,
  OPERATOR_TIMEZONES,
  WEEKDAY_SHORT,
} from "@/lib/services/rails/format";

const IDLE: RailsActionState = { status: "idle" };

export type ScheduleRow = {
  id: string;
  label: string | null;
  weekdays: number[];
  departureTimes: string[];
  capacityPerDeparture: number;
  minGuests: number;
  cutoffHours: number;
  maxAdvanceDays: number;
  timezone: string;
  seasonStart: string | null;
  seasonEnd: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function isOneOff(s: ScheduleRow) {
  return Boolean(s.seasonStart && s.seasonStart === s.seasonEnd);
}

function cutoffText(hours: number) {
  if (hours === 0) return "Bookable until departure";
  if (hours % 24 === 0) return `Bookings close ${hours / 24 === 1 ? "the day" : `${hours / 24} days`} before`;
  return `Bookings close ${hours} ${hours === 1 ? "hour" : "hours"} before`;
}

/**
 * When the trip runs, stated as a rule. The one screen an operator who has never
 * kept a calendar has to get through, so it asks in their words ("Tue, Thu and
 * Sat at 8am, twelve seats") and fills every other field with a sensible default.
 */
export default function ScheduleEditor({
  listingId,
  schedules,
  defaultTimezone,
  defaultCapacity,
}: {
  listingId: string;
  schedules: ScheduleRow[];
  defaultTimezone: string;
  defaultCapacity: number | null;
}) {
  const [editing, setEditing] = useState<string | "new" | "oneoff" | null>(schedules.length === 0 ? "new" : null);
  const patterns = schedules.filter((s) => !isOneOff(s));
  const oneOffs = schedules.filter(isOneOff);

  return (
    <div className="rl-stack">
      {schedules.length > 0 ? (
        <ul className="rl-rows">
          {[...patterns, ...oneOffs].map((s) =>
            editing === s.id ? (
              <li key={s.id} className="rl-rows__item rl-rows__item--open">
                <ScheduleForm listingId={listingId} schedule={s} onDone={() => setEditing(null)} defaultTimezone={defaultTimezone} defaultCapacity={defaultCapacity} />
              </li>
            ) : (
              <li key={s.id} className="rl-rows__item">
                <div className="rl-rows__main">
                  <span className="ds-body rl-rows__title">
                    {isOneOff(s)
                      ? `${shortDate(s.seasonStart!)} · ${s.departureTimes.map(formatLocalTime).join(", ")}`
                      : `${describeWeekdays(s.weekdays)} · ${s.departureTimes.map(formatLocalTime).join(", ")}`}
                    {isOneOff(s) ? <span className="ds-micro rl-tag">One-off</span> : null}
                  </span>
                  <span className="ds-caption rl-rows__meta">
                    {s.capacityPerDeparture} seats
                    {s.minGuests > 1 ? ` · runs with ${s.minGuests} or more` : ""}
                    {" · "}
                    {cutoffText(s.cutoffHours)}
                    {!isOneOff(s) ? ` · ${s.seasonStart || s.seasonEnd ? `${s.seasonStart ? shortDate(s.seasonStart) : "Now"} to ${s.seasonEnd ? shortDate(s.seasonEnd) : "ongoing"}` : "All year"}` : ""}
                  </span>
                </div>
                <div className="rl-rows__actions">
                  {!isOneOff(s) ? (
                    <button type="button" className="rl-btn rl-btn--quiet rl-btn--sm" onClick={() => setEditing(s.id)}>Edit</button>
                  ) : null}
                  <InlineAction action={removeScheduleAction.bind(null, listingId, s.id)} label="Remove" pending="Removing…" />
                </div>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {editing === "new" ? (
        <ScheduleForm listingId={listingId} onDone={() => setEditing(null)} defaultTimezone={defaultTimezone} defaultCapacity={defaultCapacity} first={schedules.length === 0} />
      ) : editing === "oneoff" ? (
        <OneOffForm listingId={listingId} onDone={() => setEditing(null)} defaultTimezone={schedules[0]?.timezone ?? defaultTimezone} defaultCapacity={schedules[0]?.capacityPerDeparture ?? defaultCapacity ?? 12} />
      ) : (
        <div className="rl-actions">
          <button type="button" className="rl-btn rl-btn--secondary" onClick={() => setEditing("new")}>
            {schedules.length === 0 ? "Set when it runs" : "Add another pattern"}
          </button>
          {schedules.length > 0 ? (
            <button type="button" className="rl-btn rl-btn--quiet" onClick={() => setEditing("oneoff")}>Add a one-off departure</button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ScheduleForm({
  listingId,
  schedule,
  onDone,
  defaultTimezone,
  defaultCapacity,
  first,
}: {
  listingId: string;
  schedule?: ScheduleRow;
  onDone: () => void;
  defaultTimezone: string;
  defaultCapacity: number | null;
  first?: boolean;
}) {
  const [state, formAction] = useActionState(saveScheduleAction.bind(null, listingId, schedule?.id ?? null), IDLE);
  const [days, setDays] = useState<number[]>(schedule?.weekdays ?? [2, 4, 6]);
  const [times, setTimes] = useState<string[]>(schedule?.departureTimes ?? ["08:00"]);
  const [seasonal, setSeasonal] = useState(Boolean(schedule?.seasonStart || schedule?.seasonEnd));
  const everyDay = days.length === 0 || days.length === 7;

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
      {first ? (
        <p className="ds-body-sm rl-form__lede">
          Say how the trip runs and the calendar fills itself in. You will not need to touch it again unless your pattern changes.
        </p>
      ) : null}

      <fieldset className="rl-field">
        <legend className="ds-micro rl-field__label">Days it runs</legend>
        <div className="rl-days" role="group">
          {WEEKDAY_SHORT.map((_, d) => {
            // Monday first, the way a working week is read.
            const day = (d + 1) % 7;
            const on = days.includes(day);
            return (
              <label key={day} className={`rl-day-chip${on ? " is-on" : ""}`}>
                <input
                  type="checkbox"
                  name="weekday"
                  value={day}
                  checked={days.includes(day)}
                  onChange={(e) => setDays((cur) => (e.target.checked ? [...cur, day] : cur.filter((x) => x !== day)))}
                />
                {WEEKDAY_SHORT[day]}
              </label>
            );
          })}
        </div>
        <span className="ds-micro rl-field__hint">{everyDay ? "Every day" : describeWeekdays(days)}</span>
      </fieldset>

      <fieldset className="rl-field">
        <legend className="ds-micro rl-field__label">Departs at</legend>
        <div className="rl-times">
          {times.map((t, i) => (
            <span key={i} className="rl-time">
              <input
                type="time"
                name="time"
                value={t}
                step={300}
                required
                onChange={(e) => setTimes((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {times.length > 1 ? (
                <button type="button" className="rl-time__remove" aria-label={`Remove ${t}`} onClick={() => setTimes((cur) => cur.filter((_, j) => j !== i))}>
                  ✕
                </button>
              ) : null}
            </span>
          ))}
          <button type="button" className="rl-btn rl-btn--quiet rl-btn--sm" onClick={() => setTimes((cur) => [...cur, "13:00"])}>
            + Another time
          </button>
        </div>
      </fieldset>

      <div className="rl-grid">
        <NumberField label="Seats per departure" name="capacity" defaultValue={schedule?.capacityPerDeparture ?? defaultCapacity ?? 12} min={1} invalid={state.status === "error" && state.field === "capacityPerDeparture"} />
        <NumberField label="Boat runs with at least" name="minGuests" defaultValue={schedule?.minGuests ?? 1} min={1} suffix="guests in total" hint="Counted across all bookings on a departure, not per booking. Guests can book before it is reached; you decide at the end whether it runs." invalid={state.status === "error" && state.field === "minGuests"} />
        <NumberField label="Online bookings close" name="cutoffHours" defaultValue={schedule?.cutoffHours ?? 24} min={0} suffix="hours before" />
        <NumberField label="Open for booking" name="maxAdvanceDays" defaultValue={schedule?.maxAdvanceDays ?? 365} min={1} suffix="days ahead" />
      </div>

      <label className="rl-field">
        <span className="ds-micro rl-field__label">Time zone the boat leaves from</span>
        <select name="timezone" defaultValue={schedule?.timezone ?? defaultTimezone} className="rl-input">
          {OPERATOR_TIMEZONES.map((z) => (
            <option key={z.value} value={z.value}>{z.label}</option>
          ))}
        </select>
      </label>

      <label className="rl-switch">
        <input type="checkbox" checked={seasonal} onChange={(e) => setSeasonal(e.target.checked)} />
        <span className="ds-body-sm">Only runs part of the year</span>
      </label>
      {seasonal ? (
        <div className="rl-grid">
          <DateField label="Season starts" name="seasonStart" defaultValue={schedule?.seasonStart ?? ""} />
          <DateField label="Season ends" name="seasonEnd" defaultValue={schedule?.seasonEnd ?? ""} invalid={state.status === "error" && state.field === "seasonEnd"} />
        </div>
      ) : null}

      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton>{schedule ? "Save schedule" : "Add schedule"}</PendingButton>
        {!first ? <button type="button" className="rl-btn rl-btn--quiet" onClick={onDone}>Cancel</button> : null}
      </div>
    </form>
  );
}

function OneOffForm({ listingId, onDone, defaultTimezone, defaultCapacity }: { listingId: string; onDone: () => void; defaultTimezone: string; defaultCapacity: number }) {
  const [state, formAction] = useActionState(addOneOffAction.bind(null, listingId), IDLE);
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
      <p className="ds-body-sm rl-form__lede">A special trip outside the usual pattern, like a New Year&rsquo;s Eve cruise.</p>
      <input type="hidden" name="timezone" value={defaultTimezone} />
      <div className="rl-grid">
        <DateField label="Date" name="date" defaultValue="" required />
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Departs at</span>
          <input type="time" name="time" defaultValue="17:00" step={300} required className="rl-input" />
        </label>
        <NumberField label="Seats" name="capacity" defaultValue={defaultCapacity} min={1} />
      </div>
      <ActionNotice state={state} />
      <div className="rl-actions">
        <PendingButton>Add departure</PendingButton>
        <button type="button" className="rl-btn rl-btn--quiet" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export function NumberField({
  label, name, defaultValue, min, suffix, invalid, step, hint,
}: { label: string; name: string; defaultValue: number | string; min?: number; suffix?: string; invalid?: boolean; step?: string; hint?: string }) {
  return (
    <label className={`rl-field${invalid ? " is-invalid" : ""}`}>
      <span className="ds-micro rl-field__label">{label}</span>
      <span className="rl-input rl-input--affix">
        <input type="number" name={name} defaultValue={defaultValue} min={min} step={step ?? "1"} inputMode="numeric" />
        {suffix ? <span className="ds-caption rl-input__suffix">{suffix}</span> : null}
      </span>
      {hint ? <span className="ds-micro rl-field__hint">{hint}</span> : null}
    </label>
  );
}

export function DateField({ label, name, defaultValue, invalid, required }: { label: string; name: string; defaultValue: string; invalid?: boolean; required?: boolean }) {
  return (
    <label className={`rl-field${invalid ? " is-invalid" : ""}`}>
      <span className="ds-micro rl-field__label">{label}</span>
      <input type="date" name={name} defaultValue={defaultValue} required={required} className="rl-input" />
    </label>
  );
}
