"use client";

import { useOptimistic, useTransition } from "react";
import { checkInAction } from "@/app/operator/rails-actions";

/**
 * Tick a party off as they step aboard. Optimistic, because on a jetty with one bar
 * of signal the tick has to land when the thumb does; the server catches up.
 */
export default function CheckInToggle({ bookingId, reference, checkedIn, name }: { bookingId: string; reference: string; checkedIn: boolean; name: string }) {
  const [optimistic, setOptimistic] = useOptimistic(checkedIn);
  const [, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={`rl-check${optimistic ? " is-on" : ""}`}
      aria-pressed={optimistic}
      aria-label={optimistic ? `Undo check-in for ${name}` : `Check in ${name}`}
      onClick={() =>
        startTransition(async () => {
          setOptimistic(!optimistic);
          await checkInAction(bookingId, reference, !optimistic);
        })
      }
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </button>
  );
}
