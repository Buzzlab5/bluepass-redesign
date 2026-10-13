"use client";

import { useActionState, useState } from "react";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import type { CheckState } from "@/app/admin/operator-pages/actions";

const IDLE: CheckState = { status: "idle" };

export type EditorField = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "lines" | "prices" | "money";
  hint?: string;
  /** As shown now, corrections included. */
  value: string;
  /** As the website has it, when a correction differs from it. */
  website?: string | null;
};

const INPUT = {
  width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid var(--color-hairline)",
  background: "var(--color-surface-1)", color: "var(--color-ink)", fontSize: 14, fontFamily: "inherit",
} as const;

/**
 * Correct a fact where it is read, instead of only flagging it. Each field starts as the
 * page shows it; a field that was corrected shows what the website says under it.
 */
export default function FactEditor({ action, fields, label = "Correct the facts" }: {
  action: (prev: CheckState, form: FormData) => Promise<CheckState>;
  fields: EditorField[];
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span><Button type="button" variant="secondary" magnetic={false} onClick={() => setOpen(true)}>{label}…</Button></span>
        {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
      </div>
    );
  }
  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, borderRadius: 12, border: "1px solid var(--color-hairline)" }}>
      {fields.map((f) => {
        // Room for what is there, counting long lines as the several lines they wrap to.
        const lines = f.value.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 90)), 0);
        const rows = f.kind === "text" || f.kind === "money" ? 0 : Math.min(12, Math.max(2, lines + 1));
        return (
          <label key={f.name} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, alignItems: "start" }}>
            <span className="ds-micro" style={{ color: "var(--color-ink-muted)", paddingTop: 9 }}>{f.label}</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {rows ? (
                <textarea name={f.name} defaultValue={f.value} rows={rows} style={INPUT} />
              ) : (
                <input name={f.name} defaultValue={f.value} inputMode={f.kind === "money" ? "decimal" : undefined} style={INPUT} />
              )}
              {f.hint ? <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>{f.hint}</span> : null}
              {f.website !== undefined && f.website !== null ? (
                <span className="ds-caption" style={{ color: "var(--color-gradient-orange)", whiteSpace: "pre-line" }}>The website says: {f.website || "nothing"}</span>
              ) : null}
            </span>
          </label>
        );
      })}
      <div style={{ display: "flex", gap: 10 }}>
        <Button type="submit" variant="primary" magnetic={false} disabled={pending}>Save corrections</Button>
        <Button type="button" variant="secondary" magnetic={false} onClick={() => setOpen(false)}>Close</Button>
      </div>
      {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
    </form>
  );
}
