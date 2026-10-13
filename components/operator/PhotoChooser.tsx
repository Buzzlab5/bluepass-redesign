"use client";

import { useActionState, useState } from "react";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import type { PhotoChoiceState } from "@/app/operator/your-page/actions";

const IDLE: PhotoChoiceState = { status: "idle" };

type Photo = { url: string; where: string[]; approved: boolean; isNew: boolean };

/**
 * Every photo on the operator's page, each with a tick. Untick the ones that should not
 * show; the rest go on the page when saved. Before the first choice every photo starts
 * ticked, since they came from the operator's own website.
 */
export default function PhotoChooser({
  action,
  photos,
  chosenBefore,
}: {
  action: (prev: PhotoChoiceState, form: FormData) => Promise<PhotoChoiceState>;
  photos: Photo[];
  chosenBefore: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [keep, setKeep] = useState(() => new Set(photos.filter((p) => !chosenBefore || p.approved || p.isNew).map((p) => p.url)));
  const toggle = (url: string) => setKeep((prev) => {
    const next = new Set(prev);
    if (next.has(url)) next.delete(url); else next.add(url);
    return next;
  });

  return (
    <form action={formAction} className="op-photos">
      <ul className="op-photos__grid">
        {photos.map((p) => {
          const on = keep.has(p.url);
          return (
            <li key={p.url}>
              <label className={`op-photo${on ? " is-on" : ""}`}>
                <input type="checkbox" name="keep" value={p.url} checked={on} onChange={() => toggle(p.url)} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" loading="lazy" className="op-photo__img" />
                <span className="op-photo__tick" aria-hidden>{on ? "✓" : ""}</span>
                <span className="ds-caption op-photo__where">
                  {p.isNew && chosenBefore ? <strong>New · </strong> : null}
                  {p.where.length > 2 ? `${p.where[0]} and ${p.where.length - 1} more` : p.where.join(" · ")}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="op-photos__foot">
        <Button type="submit" variant="primary" magnetic={false} disabled={pending}>
          {keep.size === 0 ? "Show no photos" : `Show ${keep.size} ${keep.size === 1 ? "photo" : "photos"}`}
        </Button>
        <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>{photos.length - keep.size} left off</span>
      </div>
      {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
    </form>
  );
}
