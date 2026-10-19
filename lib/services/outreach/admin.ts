/** What /admin/outreach shows: whether sending is on, who is where, and what waits for a person. */

import type { OutreachAudience, OutreachEnrolmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { agentsEnabled } from "@/lib/services/agents/runtime/events";
import { creatorCandidates, operatorCandidates, outreachLive } from "./enrol";
import type { InstantlyEvent } from "./events";
import { instantlyConfigured } from "./instantly";
import { alertRecipients } from "./notify";
import { dailyShares } from "./runner";

export function outreachSetup(env: Record<string, string | undefined> = process.env) {
  return {
    live: outreachLive(env),
    instantlyKey: instantlyConfigured(),
    webhookSecret: Boolean(env.INSTANTLY_WEBHOOK_SECRET),
    alerts: alertRecipients(env),
    agents: agentsEnabled(),
    autoReply: env.OUTREACH_AUTO_REPLY === "true",
    shares: dailyShares(env),
  };
}

export async function outreachCounts() {
  const rows = await prisma.outreachEnrolment.groupBy({ by: ["audience", "status"], _count: true });
  const by = (audience: OutreachAudience) =>
    Object.fromEntries(rows.filter((r) => r.audience === audience).map((r) => [r.status, r._count])) as Partial<Record<OutreachEnrolmentStatus, number>>;
  const [suppressed, operatorsWaiting, creatorsWaiting] = await Promise.all([
    prisma.outreachSuppression.count(),
    prisma.operatorLead.count({ where: { status: "IMPORTED", email: { not: null }, enrolments: { none: {} } } }),
    prisma.creator.count({ where: { hidden: false, partnerProfileId: null, contactEmail: { not: null }, enrolments: { none: {} } } }),
  ]);
  return { operators: by("OPERATOR"), creators: by("CREATOR"), suppressed, operatorsWaiting, creatorsWaiting };
}

/** Replies and flags nobody has dealt with yet, oldest first. */
export async function repliesForAPerson() {
  const events = await prisma.outreachEvent.findMany({
    where: { needsPerson: true, handledAt: null },
    orderBy: { createdAt: "asc" },
    take: 50,
    include: { enrolment: { select: { audience: true, operatorLead: { select: { name: true, slug: true } }, creator: { select: { name: true } } } } },
  });
  return events.map((e) => {
    const p = e.payload as InstantlyEvent & { draft?: { subject: string; body: string } };
    return {
      id: e.id,
      type: e.type,
      email: e.email,
      at: e.createdAt,
      who: e.enrolment?.operatorLead?.name ?? e.enrolment?.creator?.name ?? e.email ?? "Unknown",
      audience: e.enrolment?.audience ?? null,
      text: (p.reply_text ?? p.reply_text_snippet ?? "").trim(),
      unibox: p.unibox_url ?? null,
      draft: p.draft ?? null,
      crm: e.enrolment?.operatorLead ? `/crm` : null,
    };
  });
}

export async function markHandled(eventId: string, by: string) {
  await prisma.outreachEvent.update({ where: { id: eventId }, data: { handledAt: new Date(), handledBy: by } });
}

/** The next few people the daily batch would add, with the first message as it would read. */
export async function nextBatchPreview(n = 3) {
  const [ops, creators] = await Promise.all([operatorCandidates(n), creatorCandidates(n)]);
  return { operators: ops, creators };
}
