"use client";

import { useActionState, useState, useTransition } from "react";
import Notice from "@/components/auth/Notice";
import "@/app/creators.css";
import type { CreatorAdminState } from "@/app/admin/creators/actions";

const IDLE: CreatorAdminState = { status: "idle" };

/** The buttons on one invite: mark it sent, and tie the creator to their account once they join. */
export function InviteActions({ creatorId, invited, accounts, markInvited, link }: {
  creatorId: string;
  invited: boolean;
  accounts: { id: string; label: string }[];
  markInvited: (id: string) => Promise<CreatorAdminState>;
  link: (id: string, prev: CreatorAdminState, form: FormData) => Promise<CreatorAdminState>;
}) {
  const [notice, setNotice] = useState<CreatorAdminState>(IDLE);
  const [pending, start] = useTransition();
  const [linkState, linkAction, linking] = useActionState(link.bind(null, creatorId), IDLE);
  return (
    <div className="ca-actions">
      {!invited ? (
        <button type="button" className="bpe__btn bpe__btn--primary ca-btn" disabled={pending} onClick={() => start(async () => setNotice(await markInvited(creatorId)))}>Mark invited</button>
      ) : null}
      {accounts.length ? (
        <form action={linkAction} className="ca-link">
          <select name="partnerProfileId" className="cr-input" defaultValue="" aria-label="Their creator account">
            <option value="" disabled>They joined as…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <button type="submit" className="ob-text-btn" disabled={linking}>Link</button>
        </form>
      ) : null}
      {notice.status !== "idle" ? <Notice tone={notice.status === "done" ? "success" : "error"}>{notice.message}</Notice> : null}
      {linkState.status !== "idle" ? <Notice tone={linkState.status === "done" ? "success" : "error"}>{linkState.message}</Notice> : null}
    </div>
  );
}

export function DisputeActions({ campaignId, resolve }: { campaignId: string; resolve: (id: string, pay: boolean) => Promise<CreatorAdminState> }) {
  const [notice, setNotice] = useState<CreatorAdminState>(IDLE);
  const [pending, start] = useTransition();
  return (
    <div className="ca-actions">
      <button type="button" className="bpe__btn bpe__btn--primary ca-btn" disabled={pending} onClick={() => start(async () => setNotice(await resolve(campaignId, true)))}>It features them, pay</button>
      <button type="button" className="ob-text-btn" disabled={pending} onClick={() => start(async () => setNotice(await resolve(campaignId, false)))}>Return the credit</button>
      {notice.status !== "idle" ? <Notice tone={notice.status === "done" ? "success" : "error"}>{notice.message}</Notice> : null}
    </div>
  );
}
