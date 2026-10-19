import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { HandledButton, SendBatchButton } from "@/components/admin/OutreachActions";
import { markHandledAction, sendBatchAction } from "@/app/admin/outreach/actions";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { nextBatchPreview, outreachCounts, outreachSetup, repliesForAPerson } from "@/lib/services/outreach/admin";
import type { Candidate, Skipped } from "@/lib/services/outreach/enrol";

export const metadata = { title: "Outreach · Bluepass Admin" };
export const dynamic = "force-dynamic";

const STAGES: [string, string][] = [
  ["ENROLLED", "In the sequence"],
  ["REPLIED", "Replied"],
  ["INTERESTED", "Interested"],
  ["STOPPED", "Stopped (claimed, joined, or a person took over)"],
  ["COMPLETED", "No answer after the last email"],
  ["NOT_INTERESTED", "Said no"],
  ["UNSUBSCRIBED", "Unsubscribed"],
  ["BOUNCED", "Bounced"],
];

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="ou-check">
      <span className={ok ? "ou-check__mark is-ok" : "ou-check__mark"} aria-hidden>{ok ? "✓" : "✕"}</span>
      <span><strong>{label}</strong> <span className="ou-muted">{detail}</span></span>
    </li>
  );
}

function Preview({ title, waiting, batch }: { title: string; waiting: number; batch: { ready: Candidate[]; skipped: Skipped[] } }) {
  const reasons = Object.entries(batch.skipped.reduce<Record<string, number>>((acc, s) => {
    const key = s.reason.replace(/^[^ ]+ does not take email/, "address's domain does not take email").replace(/^someone at \S+/, "someone at the same business");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {}));
  const first = batch.ready[0];
  return (
    <div className="ou-preview">
      <h3 className="ou-preview__title">{title} <span className="ou-muted">· {waiting} not contacted yet</span></h3>
      {batch.ready.length ? (
        <p className="ou-muted">Next: {batch.ready.map((c) => c.name).join(", ")}</p>
      ) : (
        <p className="ou-muted">Nobody is ready to email.</p>
      )}
      {reasons.length ? <p className="ou-muted">Passed over on the way: {reasons.map(([r, n]) => `${n} × ${r}`).join("; ")}</p> : null}
      {first ? (
        <figure className="ou-letter">
          <figcaption>To {first.email} · {first.email1.subject}</figcaption>
          <pre>{first.email1.body}</pre>
        </figure>
      ) : null}
    </div>
  );
}

/**
 * Cold email to operators and creators. Instantly sends it from Tony's warmed mailboxes;
 * this page shows what Bluepass knows about it and what needs a person.
 */
export default async function OutreachAdmin() {
  await requireAdminOrRedirect("/admin/outreach");
  const setup = outreachSetup();
  const [counts, replies, preview] = await Promise.all([outreachCounts(), repliesForAPerson(), nextBatchPreview(3)]);

  return (
    <>
      <AdminPageHeader
        title="Outreach"
        support={setup.live
          ? `Sending is on. Each weekday up to ${setup.shares.operators} operators and ${setup.shares.creators} creators go to Instantly.`
          : "Sending is off, so nothing below has been sent. The batch shows what would go."}
      />

      <section className="adm-block">
        <header className="adm-block__head"><h2 className="ds-headline adm-block__title">Set-up</h2></header>
        <ul className="ou-checks adm-card">
          <Check ok={setup.instantlyKey} label="Instantly connected" detail={setup.instantlyKey ? "API key set." : "Set INSTANTLY_API_KEY, then run scripts/instantly-setup.ts."} />
          <Check ok={setup.webhookSecret} label="Replies come back" detail={setup.webhookSecret ? "Webhook secret set." : "Set INSTANTLY_WEBHOOK_SECRET so Instantly can report replies, bounces and unsubscribes."} />
          <Check ok={setup.alerts.length > 0} label="A person hears about replies" detail={setup.alerts.length ? setup.alerts.join(", ") : "Set OUTREACH_ALERT_EMAILS."} />
          <Check ok={setup.live} label="Sending switched on" detail={setup.live ? "OUTREACH_ENABLED is true." : "Turn on with OUTREACH_ENABLED=true once the mailboxes have warmed up."} />
          <Check ok={setup.agents} label="Reply desk agent" detail={setup.agents ? `Reads operator replies and ${setup.autoReply ? "answers them" : "drafts an answer for a person"}.` : "Off (AGENTS_ENABLED). Replies still reach a person."} />
        </ul>
      </section>

      <section className="adm-block">
        <header className="adm-block__head"><h2 className="ds-headline adm-block__title">Waiting for a person</h2></header>
        {replies.length ? (
          <ul className="ob-picks__list">
            {replies.map((r) => (
              <li key={r.id} className="ob-pick ca-row">
                <span className="ob-pick__body">
                  <span className="ob-pick__name">{r.who}</span>
                  <span className="ob-pick__state">{r.type === "lead_interested" ? "Marked interested" : r.type === "lead_wrong_person" ? "Wrong person" : "Replied"} · {r.at.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}{r.email ? ` · ${r.email}` : ""}</span>
                  {r.text ? <span className="ou-quote">{r.text.slice(0, 600)}</span> : null}
                  {r.draft ? <span className="ou-draft"><strong>Suggested answer</strong>{"\n"}{r.draft.body}</span> : null}
                  {r.unibox ? <a href={r.unibox} target="_blank" rel="noreferrer" className="ob-card__link">Answer in Instantly ↗</a> : null}
                </span>
                <HandledButton eventId={r.id} action={markHandledAction} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="ds-body adm-card" style={{ padding: 20 }}>Nothing waiting. Replies land here and in {setup.alerts[0] ?? "the alert inbox"}.</p>
        )}
      </section>

      <section className="adm-block">
        <header className="adm-block__head"><h2 className="ds-headline adm-block__title">Where everyone is</h2></header>
        <div className="ou-grid">
          {([["Operators", counts.operators, counts.operatorsWaiting], ["Creators", counts.creators, counts.creatorsWaiting]] as const).map(([label, by, waiting]) => (
            <div key={label} className="adm-card ou-stage">
              <h3 className="ou-preview__title">{label}</h3>
              <dl>
                <div><dt>Not contacted yet</dt><dd>{waiting}</dd></div>
                {STAGES.map(([key, name]) => (by as Record<string, number>)[key] ? <div key={key}><dt>{name}</dt><dd>{(by as Record<string, number>)[key]}</dd></div> : null)}
              </dl>
            </div>
          ))}
        </div>
        <p className="ds-caption ou-muted" style={{ marginTop: 10 }}>{counts.suppressed} addresses will never be emailed again (said no, unsubscribed or bounced).</p>
      </section>

      <section className="adm-block">
        <header className="adm-block__head"><h2 className="ds-headline adm-block__title">Next batch</h2></header>
        <div className="ou-grid">
          <Preview title="Operators" waiting={counts.operatorsWaiting} batch={preview.operators} />
          <Preview title="Creators" waiting={counts.creatorsWaiting} batch={preview.creators} />
        </div>
        <SendBatchButton live={setup.live} action={sendBatchAction} />
      </section>
    </>
  );
}
