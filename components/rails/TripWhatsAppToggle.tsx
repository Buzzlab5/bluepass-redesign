"use client";

import { useActionState } from "react";
import { setTripWhatsAppAction, type TripWhatsAppState } from "@/app/trip/actions";

const IDLE: TripWhatsAppState = { status: "idle" };

/** The guest's own switch for WhatsApp updates about this booking. Opting out is one tap. */
export default function TripWhatsAppToggle({ token, on, phone, operatorName }: { token: string; on: boolean; phone: string; operatorName: string }) {
  const [state, formAction, pending] = useActionState(setTripWhatsAppAction.bind(null, token, !on), IDLE);
  return (
    <form action={formAction} className="bk-wa">
      <p className="ds-body-sm bk-muted">
        {on
          ? `WhatsApp updates from ${operatorName} and Bluepass go to ${phone}: a reminder the day before, and any change to your trip.`
          : `Get a reminder the day before and any change to your trip on WhatsApp at ${phone}, from ${operatorName} and Bluepass.`}
      </p>
      <button type="submit" className="bk-cta bk-cta--quiet bk-wa__button" disabled={pending}>
        {pending ? "Saving…" : on ? "Stop WhatsApp updates" : "Send updates on WhatsApp"}
      </button>
      {state.status === "error" ? <p className="ds-caption bk-error">{state.message}</p> : null}
    </form>
  );
}
