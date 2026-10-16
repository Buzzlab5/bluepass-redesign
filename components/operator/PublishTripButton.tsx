"use client";

import { useActionState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import PendingButton from "@/components/rails/PendingButton";
import { publishListingAction, type OperatorSettingsState } from "@/app/operator/actions";

const IDLE: OperatorSettingsState = { status: "idle" };

/** Puts a draft trip on sale from the trip's own page, so setting it up and publishing it happen in one place. */
export default function PublishTripButton({ listingId, ready }: { listingId: string; ready: boolean }) {
  const [state, formAction] = useActionState(publishListingAction.bind(null, listingId), IDLE);

  return (
    <form action={formAction} className="rl-ready__action">
      <PendingButton pending="Publishing…" disabled={!ready}>Publish trip</PendingButton>
      <span className="ds-micro rl-muted">
        {ready ? "Travellers can book it as soon as it is published." : "Add when it runs and a price first."}
      </span>
      <ActionNotice state={state} />
    </form>
  );
}
