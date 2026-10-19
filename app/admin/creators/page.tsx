import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { DisputeActions, InviteActions } from "@/components/admin/CreatorAdminRows";
import { linkAccountAction, markInvitedAction, resolveDisputeAction } from "@/app/admin/creators/actions";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { creatorDirectoryCounts, disputedPosts, invitesToSend, linkableCreatorAccounts } from "@/lib/services/onboarding/creator-admin";
import { formatCredit } from "@/lib/services/onboarding/credits";

export const metadata = { title: "Creators · Bluepass Admin" };
export const dynamic = "force-dynamic";

/**
 * The creators operators picked when they joined. Most get an invite email from Tony through
 * Instantly (see /admin/outreach); anyone without a published email needs a person, usually
 * an Instagram message. A creator who signs up with the same email or Instagram account is
 * linked on approval; anyone else is linked here.
 */
export default async function CreatorsAdmin() {
  await requireAdminOrRedirect("/admin/creators");
  const [invites, disputes, accounts, counts] = await Promise.all([invitesToSend(), disputedPosts(), linkableCreatorAccounts(), creatorDirectoryCounts()]);
  const waiting = invites.filter((i) => !i.invitedAt && !i.emailed);

  return (
    <>
      <AdminPageHeader
        title="Creators"
        support={`${counts.total} creators operators can pick, ${counts.joined} on Bluepass. ${waiting.length ? `${waiting.length} picked ${waiting.length === 1 ? "creator has" : "creators have"} no invite yet.` : "Every picked creator has an invite."}`}
      />

      <section className="adm-block">
        <header className="adm-block__head"><h2 className="ds-headline adm-block__title">Invites to send</h2></header>
        {invites.length ? (
          <ul className="ob-picks__list">
            {invites.map((c) => (
              <li key={c.id} className="ob-pick ca-row">
                <span className="ob-pick__body">
                  <span className="ob-pick__name">{c.name}{c.brand && c.brand !== c.name ? ` · ${c.brand}` : ""}</span>
                  <span className="ob-pick__state">Picked by {c.pickedBy.join(", ")}{c.base ? ` · ${c.base}` : ""}</span>
                  <span className="ca-contact">
                    {c.website ? <a href={c.website} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\/(www\.)?/, "")} ↗</a> : null}
                    {c.instagram ? <a href={`https://www.instagram.com/${c.instagram}/`} target="_blank" rel="noreferrer">@{c.instagram}</a> : null}
                    {c.contactEmail ? <span>{c.contactEmail}</span> : null}
                  </span>
                  {c.emailed ? <span className="ob-pick__state">Invite email {c.emailed.status === "ENROLLED" ? "sent" : c.emailed.status.toLowerCase().replace(/_/g, " ")} · {c.emailed.at.toLocaleDateString("en-AU")}</span> : null}
                  {c.invitedAt ? <span className="ob-pick__state">Invited by {c.invitedBy} on {c.invitedAt.toLocaleDateString("en-AU")}</span> : null}
                </span>
                <InviteActions creatorId={c.id} invited={Boolean(c.invitedAt)} accounts={accounts} markInvited={markInvitedAction} link={linkAccountAction} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="ds-body adm-card" style={{ padding: 20 }}>No operator has picked a creator who needs inviting.</p>
        )}
        <p className="ds-caption" style={{ color: "var(--color-ink-muted)", marginTop: 10 }}>
          Creators with a published email get one invite from Tony through Instantly. For the rest, send an Instagram message yourself and mark it here.
        </p>
      </section>

      {disputes.length ? (
        <section className="adm-block">
          <header className="adm-block__head"><h2 className="ds-headline adm-block__title">Posts an operator questioned</h2></header>
          <ul className="ob-picks__list">
            {disputes.map((d) => (
              <li key={d.id} className="ob-pick ca-row">
                <span className="ob-pick__body">
                  <span className="ob-pick__name">{d.creator.name} for {d.operatorName}</span>
                  <span className="ob-pick__state">{formatCredit(d.creditCents, d.currency)} held{d.disputedAt ? ` since ${d.disputedAt.toLocaleDateString("en-AU")}` : ""}</span>
                  {d.postUrl ? <a href={d.postUrl} target="_blank" rel="noreferrer" className="ob-card__link">See the post ↗</a> : null}
                </span>
                <DisputeActions campaignId={d.id} resolve={resolveDisputeAction} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
