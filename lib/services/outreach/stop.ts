/**
 * Taking someone out of a sequence because of something that happened on Bluepass: an
 * operator claimed their page, a creator joined, or a person took the conversation over.
 * The next follow-up must never arrive after they have already said yes.
 */

import type { OutreachEnrolmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { campaignId, type CampaignKey } from "./campaigns";
import { instantlyConfigured, removeLeads } from "./instantly";

const RUNNING: OutreachEnrolmentStatus[] = ["ENROLLED", "REPLIED", "INTERESTED"];

export async function stopOutreach(target: { operatorLeadId?: string; operatorSlug?: string; creatorId?: string; email?: string }, reason: string) {
  const or = [
    target.operatorLeadId ? { operatorLeadId: target.operatorLeadId } : null,
    target.operatorSlug ? { operatorLead: { slug: target.operatorSlug } } : null,
    target.creatorId ? { creatorId: target.creatorId } : null,
    target.email ? { email: target.email.toLowerCase() } : null,
  ].filter((x): x is NonNullable<typeof x> => Boolean(x));
  if (!or.length) return { stopped: 0 };

  const running = await prisma.outreachEnrolment.findMany({ where: { status: { in: RUNNING }, OR: or } });
  let stopped = 0;
  for (const e of running) {
    if (e.instantlyLeadId && instantlyConfigured()) {
      try {
        const id = await campaignId(e.campaignKey as CampaignKey);
        if (id) await removeLeads(id, [e.instantlyLeadId]);
      } catch (error) {
        // Recorded as stopped anyway: Instantly also stops on reply, and a person can see it here.
        console.error("outreach.stop_failed", { enrolment: e.id, error: error instanceof Error ? error.message : error });
      }
    }
    await prisma.outreachEnrolment.update({ where: { id: e.id }, data: { status: "STOPPED", stopReason: reason, lastEventAt: new Date() } });
    stopped += 1;
  }
  return { stopped };
}

/** Best effort from inside other flows: outreach must never break a claim or an approval. */
export async function stopOutreachQuietly(target: Parameters<typeof stopOutreach>[0], reason: string) {
  try {
    await stopOutreach(target, reason);
  } catch (error) {
    console.error("outreach.stop_error", { reason, error: error instanceof Error ? error.message : error });
  }
}
