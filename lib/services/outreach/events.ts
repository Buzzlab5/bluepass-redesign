/**
 * What Instantly tells us, and what Bluepass does about it.
 *
 *   email_sent           the operator's lead moves to Contacted and the CRM shows when
 *   reply_received       a person is tapped; a plain "no thanks" is honoured on the spot;
 *                        an operator's reply also goes to the reply desk agent when agents are on
 *   lead_interested      In discussion, and a person is tapped
 *   lead_not_interested,
 *   lead_unsubscribed    never contacted again (suppressed), lead Declined
 *   email_bounced        suppressed, so a dead address is never tried twice
 *   lead_wrong_person    out of the sequence, and a person looks (they often name the right one)
 *
 * Deliveries are retried by Instantly, so each one is recorded once under a key built from
 * what it says; a repeat is acknowledged and ignored.
 */

import { Prisma, type OutreachEnrolment, type OutreachEnrolmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { emitDomainEvent } from "@/lib/services/agents/runtime/events";
import { campaignKeyFor } from "./campaigns";
import { notifyTeam } from "./notify";
import { stopOutreach } from "./stop";

export type InstantlyEvent = {
  event_type?: string;
  timestamp?: string;
  campaign_id?: string;
  campaign_name?: string;
  lead_email?: string;
  email_account?: string;
  email_id?: string;
  step?: number;
  reply_text?: string;
  reply_text_snippet?: string;
  reply_subject?: string;
  unibox_url?: string;
  [key: string]: unknown;
};

/** A reply that plainly says stop. Anything less clear goes to a person. */
const OPT_OUT = /^\s*(no,? thanks?|no thank you|not interested|unsubscribe|remove me|please remove|stop( emailing)?|take me off)\b/i;

function dedupeKey(e: InstantlyEvent) {
  return [e.event_type, e.email_id ?? "", (e.lead_email ?? "").toLowerCase(), e.timestamp ?? "", e.step ?? ""].join("|").slice(0, 500);
}

async function suppress(email: string, reason: string) {
  await prisma.outreachSuppression.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), reason, source: "instantly" },
    update: {},
  });
}

async function leadEvent(enrolment: OutreachEnrolment | null, type: string, message: string | null, metadata: Record<string, unknown>, status?: "CONTACTED" | "IN_DISCUSSION" | "DECLINED") {
  if (!enrolment?.operatorLeadId) return;
  const lead = await prisma.operatorLead.findUnique({ where: { id: enrolment.operatorLeadId }, select: { id: true, slug: true, status: true } });
  if (!lead) return;
  await prisma.operatorOutreachEvent.create({
    data: { operatorLeadId: lead.id, operatorSlug: lead.slug, type, message, metadata: metadata as Prisma.InputJsonValue },
  });
  // A claim or a signing outranks anything an email says, so those are never moved backwards.
  const settled = ["CLAIM_SUBMITTED", "APPROVED", "LIVE"].includes(lead.status);
  const data: Prisma.OperatorLeadUpdateInput = { lastOutreachAt: new Date() };
  if (status && !settled && !(status === "CONTACTED" && lead.status !== "IMPORTED")) data.status = status;
  await prisma.operatorLead.update({ where: { id: lead.id }, data });
}

async function setStatus(enrolment: OutreachEnrolment | null, status: OutreachEnrolmentStatus, stopReason?: string) {
  if (!enrolment) return;
  await prisma.outreachEnrolment.update({ where: { id: enrolment.id }, data: { status, lastEventAt: new Date(), ...(stopReason ? { stopReason } : {}) } });
}

function who(enrolment: OutreachEnrolment | null, email: string) {
  return enrolment ? `${enrolment.audience === "OPERATOR" ? "Operator" : "Creator"} ${email}` : email;
}

export async function handleInstantlyEvent(e: InstantlyEvent, opts: { now?: Date } = {}) {
  const type = e.event_type ?? "unknown";
  const email = e.lead_email?.toLowerCase() ?? null;
  const key = await campaignKeyFor(e.campaign_id).catch(() => null);
  const enrolment = email
    ? await prisma.outreachEnrolment.findFirst({ where: { email, ...(key ? { campaignKey: key } : {}) }, orderBy: { createdAt: "desc" } })
    : null;

  const reply = (e.reply_text ?? e.reply_text_snippet ?? "").trim();
  const optOut = type === "reply_received" && OPT_OUT.test(reply);
  const needsPerson = (type === "reply_received" && !optOut) || type === "lead_interested" || type === "lead_wrong_person";

  let event;
  try {
    event = await prisma.outreachEvent.create({
      data: {
        dedupeKey: dedupeKey(e), type, email, enrolmentId: enrolment?.id ?? null, campaignId: e.campaign_id ?? null,
        payload: e as Prisma.InputJsonValue, needsPerson, createdAt: opts.now,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { duplicate: true as const };
    throw error;
  }

  const meta = { campaign: key, step: e.step ?? null, unibox: e.unibox_url ?? null, eventId: event.id };
  switch (type) {
    case "email_sent":
      if (enrolment) await prisma.outreachEnrolment.update({ where: { id: enrolment.id }, data: { lastEventAt: new Date() } });
      await leadEvent(enrolment, "outreach.email_sent", null, meta, "CONTACTED");
      break;
    case "reply_received":
      if (optOut) {
        if (email) await suppress(email, "replied no");
        await setStatus(enrolment, "NOT_INTERESTED", "replied no");
        await leadEvent(enrolment, "outreach.reply_no", reply, meta, "DECLINED");
        break;
      }
      await setStatus(enrolment, "REPLIED");
      await leadEvent(enrolment, "outreach.reply", reply, meta, "IN_DISCUSSION");
      if (enrolment?.operatorLeadId) {
        await emitDomainEvent({
          action: "operator.reply_received", entityType: "operator_lead", entityId: enrolment.operatorLeadId, eventId: event.id,
          metadata: { message: reply, emailId: e.email_id ?? null, fromAccount: e.email_account ?? null, subject: e.reply_subject ?? null },
        });
      }
      await notifyTeam({
        subject: `Reply from ${email ?? "a prospect"}`,
        text: `${who(enrolment, email ?? "unknown")} replied:\n\n${reply.slice(0, 1500) || "(no text)"}\n\nAnswer it in Instantly: ${e.unibox_url ?? "the Unibox"}\nOr see it in the admin: /admin/outreach`,
      });
      break;
    case "lead_interested":
      await setStatus(enrolment, "INTERESTED");
      await leadEvent(enrolment, "outreach.interested", null, meta, "IN_DISCUSSION");
      await notifyTeam({ subject: `Interested: ${email}`, text: `${who(enrolment, email ?? "unknown")} was marked interested in Instantly.\n\n${e.unibox_url ?? ""}` });
      break;
    case "lead_not_interested":
    case "lead_unsubscribed":
      if (email) await suppress(email, type === "lead_unsubscribed" ? "unsubscribed" : "not interested");
      await setStatus(enrolment, type === "lead_unsubscribed" ? "UNSUBSCRIBED" : "NOT_INTERESTED");
      await leadEvent(enrolment, `outreach.${type === "lead_unsubscribed" ? "unsubscribed" : "not_interested"}`, null, meta, "DECLINED");
      break;
    case "email_bounced":
      if (email) await suppress(email, "bounced");
      await setStatus(enrolment, "BOUNCED");
      await leadEvent(enrolment, "outreach.bounced", null, meta);
      break;
    case "lead_wrong_person":
      // Out of Instantly first; stopOutreach only touches sequences still running.
      if (enrolment) await stopOutreach({ email: enrolment.email }, "wrong person").catch(() => undefined);
      await setStatus(enrolment, "STOPPED", "wrong person");
      await leadEvent(enrolment, "outreach.wrong_person", reply || null, meta);
      await notifyTeam({ subject: `Wrong person: ${email}`, text: `${who(enrolment, email ?? "unknown")} is the wrong contact. They may have named the right one:\n\n${e.unibox_url ?? ""}` });
      break;
    case "campaign_completed":
      if (enrolment?.status === "ENROLLED") await setStatus(enrolment, "COMPLETED");
      break;
    default:
      if (enrolment) await prisma.outreachEnrolment.update({ where: { id: enrolment.id }, data: { lastEventAt: new Date() } });
  }
  return { duplicate: false as const, eventId: event.id, needsPerson };
}
