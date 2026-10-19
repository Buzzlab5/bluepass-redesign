/**
 * Connects the agent runtime to the real world: Instantly becomes the email sender behind
 * `dispatch`, and decisions an agent raises reach a person by email. Called once at server
 * start (instrumentation.ts).
 *
 * Replies are the one place an agent's words would go out under Tony's own name, in a thread
 * he started, so they are drafted rather than sent unless OUTREACH_AUTO_REPLY=true.
 */

import { prisma } from "@/lib/db/prisma";
import { setDispatcher, type Dispatcher } from "@/lib/services/agents/tools/dispatch";
import { setDecisionNotifier } from "@/lib/services/agents/runtime/decisions";
import { enrolOperatorWithCopy, outreachLive } from "./enrol";
import type { InstantlyEvent } from "./events";
import { instantlyConfigured, replyToEmail } from "./instantly";
import { alertRecipients, notifyTeam } from "./notify";

export const instantlyDispatcher: Dispatcher = async (req) => {
  if (req.channel !== "email") return { status: "prepared", reason: `${req.channel} is not sent through Instantly.` };
  const leadId = req.reference.startsWith("lead:") ? req.reference.slice(5) : null;
  if (!leadId) return { status: "prepared", reason: "No lead on the message, so it cannot be matched to a thread." };

  const enrolment = await prisma.outreachEnrolment.findFirst({ where: { operatorLeadId: leadId }, orderBy: { createdAt: "desc" } });
  if (enrolment) {
    const last = await prisma.outreachEvent.findFirst({ where: { enrolmentId: enrolment.id, type: "reply_received" }, orderBy: { createdAt: "desc" } });
    const reply = last?.payload as InstantlyEvent | undefined;
    if (!last || !reply?.email_id || !reply.email_account) {
      return { status: "prepared", reason: "They have not replied in Instantly yet, so there is no thread to answer." };
    }
    const subject = req.subject ?? `Re: ${reply.reply_subject ?? enrolment.subject}`;
    if (process.env.OUTREACH_AUTO_REPLY !== "true" || !outreachLive()) {
      await prisma.outreachEvent.update({
        where: { id: last.id },
        data: { payload: { ...reply, draft: { subject, body: req.body } }, needsPerson: true, handledAt: null },
      });
      return { status: "prepared", reason: "Replies go out from Tony's own inbox, so a person sends them. The draft is saved with the reply in /admin/outreach." };
    }
    const sent = await replyToEmail({ replyToId: reply.email_id, fromAccount: reply.email_account, subject, text: req.body });
    return { status: "sent", providerId: sent.id };
  }

  if (!outreachLive()) return { status: "prepared", reason: "Sending is switched off here (OUTREACH_ENABLED), so the draft is saved on the lead." };
  const result = await enrolOperatorWithCopy(leadId, { subject: req.subject ?? "", body: req.body });
  return result.ok ? { status: "sent", providerId: null } : { status: "prepared", reason: `Not sent: ${result.reason}` };
};

let wired = false;

export function wireOutreach() {
  if (wired) return;
  wired = true;
  if (instantlyConfigured()) setDispatcher(instantlyDispatcher);
  if (alertRecipients().length) {
    setDecisionNotifier(async (notice) => {
      await notifyTeam({
        subject: `Decision needed: ${notice.title}`,
        text: [
          notice.summary,
          `If nobody answers by ${notice.expiresAt.toUTCString()}, it will: ${notice.defaultAction}.`,
          ...notice.links.map((l) => `${l.action}: ${l.url}`),
        ].join("\n\n"),
      });
    });
  }
}
