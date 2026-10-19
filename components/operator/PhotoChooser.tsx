"use client";

import { useActionState, useState } from "react";
import Notice from "@/components/auth/Notice";
import { failedAlready } from "@/components/operators/LinkedPhoto";
import Button from "@/components/ui/Button";
import type { PhotoChoiceState } from "@/app/operator/your-page/actions";

const IDLE: PhotoChoiceState = { status: "idle" };

type Photo = { url: string; where: string[]; approved: boolean; isNew: boolean };

/**
 * Every photo on the operator's page, each with a tick. Untick the ones that should not
 * show; the rest go on the page when saved. Before the first choice every photo starts
 * ticked, since they came from the operator's own website. A photo their website will
 * not send to other pages cannot show on Bluepass either, so it drops out of the list.
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
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const fail = (url: string) => setFailed((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  const shown = photos.filter((p) => !failed.has(p.url));
  const [keep, setKeep] = useState(() => new Set(photos.filter((p) => !chosenBefore || p.approved || p.isNew).map((p) => p.url)));
  const toggle = (url: string) => setKeep((prev) => {
    const next = new Set(prev);
    if (next.has(url)) next.delete(url); else next.add(url);
    return next;
  });

  return (
    <form action={formAction} className="op-photos">
      <ul className="op-photos__grid">
        {shown.map((p) => {
          const on = keep.has(p.url);
          return (
            <li key={p.url}>
              <label className={`op-photo${on ? " is-on" : ""}`}>
                <input type="checkbox" name="keep" value={p.url} checked={on} onChange={() => toggle(p.url)} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="op-photo__img"
                  ref={(img) => { if (failedAlready(img)) fail(p.url); }}
                  onError={() => fail(p.url)}
                />
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
      {failed.size ? (
        <p className="ds-caption" style={{ color: "var(--color-ink-muted)", margin: 0 }}>
          {shown.length === 0
            ? "Your website does not let other sites show its photos, so there are none to choose here. Add your own above."
            : `${failed.size} ${failed.size === 1 ? "photo" : "photos"} from your website will not load on other sites, so ${failed.size === 1 ? "it is" : "they are"} left out.`}
        </p>
      ) : null}
      <div className="op-photos__foot" hidden={shown.length === 0}>
        <Button type="submit" variant="primary" magnetic={false} disabled={pending}>
          {keep.size === 0 ? "Show no photos" : `Show ${keep.size} ${keep.size === 1 ? "photo" : "photos"}`}
        </Button>
        <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>{shown.filter((p) => !keep.has(p.url)).length} left off</span>
      </div>
      {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
    </form>
  );
}
