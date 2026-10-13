"use client";

import { useActionState } from "react";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import type { CheckState } from "@/app/admin/operator-pages/actions";

const IDLE: CheckState = { status: "idle" };

/** One press for every trip on the page still waiting, once each has been read. */
export default function ApproveWaiting({ action, waiting }: { action: (prev: CheckState) => Promise<CheckState>; waiting: number }) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  return (
    <form action={formAction} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <Button type="submit" variant="secondary" magnetic={false} disabled={pending || waiting === 0}>
        {waiting === 0 ? "No trips waiting" : `Approve the ${waiting} waiting ${waiting === 1 ? "trip" : "trips"}`}
      </Button>
      <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>Leaves trips that need a fix or look out of date.</span>
      {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
    </form>
  );
}
