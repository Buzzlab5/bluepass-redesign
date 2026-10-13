"use client";

import { useActionState } from "react";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import type { PhotoChoiceState } from "@/app/operator/your-page/actions";

const IDLE: PhotoChoiceState = { status: "idle" };

type Trip = { id: string; title: string; listingId: string | null; by: "name" | "operator" | null };
type Product = { id: string; title: string; sells: boolean };

/** Each trip on the operator's page, and the Rezdy trip a traveller books it through. */
export default function BookingChooser({ action, trips, products }: {
  action: (prev: PhotoChoiceState, form: FormData) => Promise<PhotoChoiceState>;
  trips: Trip[];
  products: Product[];
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  return (
    <form action={formAction} className="adm-card" style={{ padding: 0 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {trips.map((t) => (
          <li key={t.id} className="op-match">
            <span className="op-match__trip">
              <span className="ds-body-sm">{t.title}</span>
              <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>
                {t.listingId ? (t.by === "operator" ? "Set by you" : "Matched by name") : t.by === "operator" ? "You said it is not on Rezdy" : "Not matched yet"}
              </span>
            </span>
            <select name={`trip:${t.id}`} defaultValue={t.listingId ?? "none"} className="op-match__select" aria-label={`Rezdy trip for ${t.title}`}>
              <option value="none">Not on Rezdy</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.title}{p.sells ? "" : " (not on sale on Bluepass)"}</option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderTop: "1px solid var(--color-hairline-soft)", flexWrap: "wrap" }}>
        <Button type="submit" variant="primary" magnetic={false} disabled={pending}>Save matches</Button>
        {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
        {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      </div>
    </form>
  );
}
