"use client";

import { useActionState } from "react";
import ActionNotice from "@/components/rails/ActionNotice";
import PendingButton from "@/components/rails/PendingButton";
import type { RailsActionState } from "@/app/operator/rails-actions";

const IDLE: RailsActionState = { status: "idle" };

/** One button that runs one server action and reports back underneath. */
export default function InlineAction({
  action,
  label,
  pending,
  variant = "quiet",
  danger,
}: {
  action: (prev: RailsActionState) => Promise<RailsActionState>;
  label: string;
  pending?: string;
  variant?: "primary" | "secondary" | "quiet";
  danger?: boolean;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  return (
    <form action={formAction} className="rl-inline">
      <PendingButton variant={variant} danger={danger} small pending={pending}>
        {label}
      </PendingButton>
      {state.status === "error" ? <ActionNotice state={state} /> : null}
    </form>
  );
}
