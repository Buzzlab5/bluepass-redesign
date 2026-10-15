"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type PickerDate = { value: string; label: string; note: string };

/**
 * Which trip and which day, for a booking taken over the phone.
 *
 * The day list is built from the trip's own schedule, so every date on offer has a departure with a
 * seat left. The operator never has to remember that a trip runs Tuesdays and Saturdays, or find out
 * by trying a Thursday. Choosing either one loads the departures for that day straight away.
 */
export default function NewBookingPicker({
  listings,
  listingId,
  dates,
  date,
}: {
  listings: { id: string; title: string }[];
  listingId: string;
  dates: PickerDate[];
  date: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (next: { listing: string; date?: string }) => {
    const params = new URLSearchParams({ listing: next.listing });
    if (next.date) params.set("date", next.date);
    startTransition(() => router.push(`/operator/bookings/new?${params.toString()}`));
  };

  return (
    <div className="rl-pick adm-card" aria-busy={pending}>
      <label className="rl-field">
        <span className="ds-micro rl-field__label">Trip</span>
        <select value={listingId} onChange={(event) => go({ listing: event.target.value })} className="rl-input" disabled={pending}>
          {listings.map((l) => (
            <option key={l.id} value={l.id}>{l.title}</option>
          ))}
        </select>
      </label>
      <label className="rl-field">
        <span className="ds-micro rl-field__label">Day</span>
        <select value={date} onChange={(event) => go({ listing: listingId, date: event.target.value })} className="rl-input" disabled={pending || dates.length === 0}>
          {dates.length === 0 ? <option value="">No days with seats left</option> : null}
          {dates.map((d) => (
            <option key={d.value} value={d.value}>{d.label}{d.note ? ` · ${d.note}` : ""}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
