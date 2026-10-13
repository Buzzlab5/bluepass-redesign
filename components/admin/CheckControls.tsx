"use client";

import { useActionState, useState } from "react";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import type { CheckState } from "@/app/admin/operator-pages/actions";

const IDLE: CheckState = { status: "idle" };

/**
 * Approve, or say what needs fixing. A note is required for "needs a fix", because a
 * flag with no reason cannot be acted on.
 */
export default function CheckControls({
  action,
  status,
  notes,
  approveLabel = "Approve",
}: {
  action: (prev: CheckState, form: FormData) => Promise<CheckState>;
  status: string;
  notes: string | null;
  approveLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [fixing, setFixing] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {notes && status === "needs_fix" ? <p className="ds-caption" style={{ color: "var(--color-gradient-orange)" }}>Needs a fix: {notes}</p> : null}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <form action={formAction}>
          <input type="hidden" name="status" value="approved" />
          <Button type="submit" variant={status === "approved" ? "secondary" : "primary"} magnetic={false} disabled={pending || status === "approved"}>
            {status === "approved" ? "Approved" : approveLabel}
          </Button>
        </form>
        {!fixing ? (
          <Button type="button" variant="secondary" magnetic={false} onClick={() => setFixing(true)}>Needs a fix…</Button>
        ) : null}
        {status !== "pending" ? (
          <form action={formAction}>
            <input type="hidden" name="status" value="pending" />
            <Button type="submit" variant="secondary" magnetic={false} disabled={pending}>Undo</Button>
          </form>
        ) : null}
      </div>
      {fixing ? (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 8 }} onSubmit={() => setFixing(false)}>
          <input type="hidden" name="status" value="needs_fix" />
          <textarea name="notes" rows={2} required placeholder="What is wrong, and what the source says instead" className="afield__input"
            style={{ padding: 10, borderRadius: 10, border: "1px solid var(--color-hairline)", background: "var(--color-surface-1)", color: "var(--color-ink)", fontSize: 14 }} />
          <div style={{ display: "flex", gap: 10 }}>
            <Button type="submit" variant="primary" magnetic={false} disabled={pending}>Save</Button>
            <Button type="button" variant="secondary" magnetic={false} onClick={() => setFixing(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
    </div>
  );
}
