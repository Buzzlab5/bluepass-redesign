"use client";

import { useState, useTransition } from "react";
import Notice from "@/components/auth/Notice";
import "@/app/creators.css";
import type { OutreachAdminState } from "@/app/admin/outreach/actions";

const IDLE: OutreachAdminState = { status: "idle" };

function useAction() {
  const [notice, setNotice] = useState<OutreachAdminState>(IDLE);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<OutreachAdminState>) => start(async () => setNotice(await fn()));
  const shown = notice.status === "idle" ? null : <Notice tone={notice.status === "error" ? "error" : "success"}>{notice.message}</Notice>;
  return { pending, run, shown };
}

export function HandledButton({ eventId, action }: { eventId: string; action: (id: string) => Promise<OutreachAdminState> }) {
  const { pending, run, shown } = useAction();
  return (
    <span className="ca-actions">
      <button type="button" className="bpe__btn ca-btn" disabled={pending} onClick={() => run(() => action(eventId))}>Handled</button>
      {shown}
    </span>
  );
}

export function SendBatchButton({ live, action }: { live: boolean; action: () => Promise<OutreachAdminState> }) {
  const { pending, run, shown } = useAction();
  return (
    <span className="ou-send">
      <button type="button" className={`bpe__btn ${live ? "bpe__btn--primary" : ""} ca-btn`} disabled={pending} onClick={() => run(action)}>
        {pending ? "Working…" : live ? "Send today's batch now" : "Rehearse today's batch"}
      </button>
      {shown}
    </span>
  );
}
