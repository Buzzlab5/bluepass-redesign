/**
 * Every agent action on an operator lead is written to the same log the
 * outreach desk already reads: `OperatorOutreachEvent`. That is deliberate.
 * A lead's history has to be one readable thread whether the entry came
 * from a claim link going out, from someone picking up the phone, or from
 * an agent. A second, agent-only table would split the story in half.
 *
 * Event types are namespaced `agent.*` so the desk can tell at a glance who
 * did what, and so a filter can exclude them if a person wants only the
 * human touches.
 */

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

export type AgentLeadEventType =
  | "agent.platform_assessed"
  | "agent.first_touch_drafted"
  | "agent.first_touch_sent"
  | "agent.follow_up_sent"
  | "agent.reply_classified"
  | "agent.claim_invited"
  | "agent.onboarding_step"
  | "agent.flagged_for_person"
  | "agent.suppressed";

export async function logLeadEvent(params: {
  leadId: string;
  slug: string;
  type: AgentLeadEventType;
  message?: string;
  metadata?: Record<string, unknown>;
  /** Stamp the lead as touched. Only for events that actually reached them. */
  touched?: boolean;
  now?: Date;
}): Promise<void> {
  await prisma.operatorOutreachEvent.create({
    data: {
      operatorLeadId: params.leadId,
      operatorSlug: params.slug,
      type: params.type,
      message: params.message ?? null,
      metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
  if (params.touched) {
    await prisma.operatorLead.update({
      where: { id: params.leadId },
      data: { lastOutreachAt: params.now ?? new Date() },
    });
  }
}

/** Reads back what agents and people have already done to this lead. */
export async function leadHistory(leadId: string, take = 20) {
  return prisma.operatorOutreachEvent.findMany({
    where: { operatorLeadId: leadId },
    orderBy: { createdAt: "desc" },
    take,
    select: { type: true, message: true, metadata: true, createdAt: true },
  });
}

/** The assessment the Scout left on a lead, or null if it has not seen it. */
export async function latestAssessment(
  leadId: string,
): Promise<Record<string, unknown> | null> {
  const row = await prisma.operatorOutreachEvent.findFirst({
    where: { operatorLeadId: leadId, type: "agent.platform_assessed" },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  return (row?.metadata as Record<string, unknown> | null) ?? null;
}
