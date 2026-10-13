"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/**
 * A plain submit button that knows its form is in flight. Plain rather than the
 * magnetic site Button: these sit in dense operator lists where a button drifting
 * toward the cursor reads as a mis-click waiting to happen.
 */
export default function PendingButton({
  children,
  pending: pendingLabel,
  variant = "primary",
  danger,
  small,
  disabled,
}: {
  children: ReactNode;
  pending?: string;
  variant?: "primary" | "secondary" | "quiet";
  danger?: boolean;
  small?: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`rl-btn rl-btn--${variant}${danger ? " rl-btn--danger" : ""}${small ? " rl-btn--sm" : ""}`}
    >
      {pending ? pendingLabel ?? "Saving…" : children}
    </button>
  );
}
