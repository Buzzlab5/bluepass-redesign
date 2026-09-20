/**
 * Agent 05 · Onboarder (Wave 1).
 *
 * Takes an operator from "yes" to bookable, and keeps them moving when they
 * stall. Two halves, because the schema has two:
 *
 *   A lead who agreed still has to claim their page. The Onboarder gets the
 *   claim link to the address on file and chases it once.
 *
 *   A claimed operator has an OperatorPmsReadiness row that walks from
 *   needs-credentials to synced. Most operators stop somewhere in the
 *   middle, and what unsticks them is a specific message about the one
 *   thing that is missing, not a reminder that they have not finished.
 *
 * It never fills anything in for them. The claim binds an account to a
 * business, and an agent doing that on an operator's behalf would be
 * impersonation in the one flow where identity matters most.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { logLeadEvent } from "../tools/lead-log";
import { dispatch } from "../tools/dispatch";
import { verifyOutbound } from "./verifier";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const ONBOARDER_ID = "onboarder";

/** What each readiness state is actually waiting on. */
const READINESS_BLOCKER: Record<string, string> = {
  NEEDS_CREDENTIALS:
    "They have not connected their booking system yet. What is needed is the one approval step inside their own system that lets BluePass read their trips. They never hand over a password.",
  CREDENTIALS_SUBMITTED:
    "Credentials are in and BluePass has not confirmed the connection. This is usually on BluePass, not on them: say so plainly rather than asking them for anything.",
  CONNECTED:
    "The connection works but no trips have synced. Either their system has nothing published, or the sync has not run against them yet.",
  SYNCED: "They are connected and their trips are in. Nothing is blocking them.",
  MANUAL_REVIEW: "Someone at BluePass has to look at this one. Do not message the operator.",
};

const listStalled: AgentTool = {
  name: "list_operators_to_move",
  description:
    "List operators who are part way through onboarding and have stopped: leads who agreed but have not claimed, and claimed operators whose booking system is not connected or synced. Call this first.",
  schema: z.object({ limit: z.number().int().min(1).max(12).optional() }),
  run: async (input, ctx) => {
    const limit = input.limit ?? 6;

    const agreedNotClaimed = await prisma.operatorLead.findMany({
      where: { status: { in: ["IN_DISCUSSION", "APPROVED"] }, claimUrl: { not: null } },
      orderBy: { lastOutreachAt: "asc" },
      take: limit,
      select: { id: true, name: true, email: true, claimUrl: true, status: true, lastOutreachAt: true },
    });

    const stalledReadiness = await prisma.operatorPmsReadiness.findMany({
      where: { status: { in: ["NEEDS_CREDENTIALS", "CREDENTIALS_SUBMITTED", "CONNECTED"] } },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: {
        id: true,
        platform: true,
        status: true,
        contactEmail: true,
        notes: true,
        updatedAt: true,
        operatorProfile: { select: { id: true, companyName: true, websiteUrl: true } },
      },
    });

    ctx.outcome.leads = agreedNotClaimed.map((l) => l.id);
    ctx.outcome.readiness = stalledReadiness.map((r) => r.id);

    if (agreedNotClaimed.length === 0 && stalledReadiness.length === 0) {
      return "Nobody is stalled. Nothing to do; end the turn.";
    }

    const parts: string[] = [];
    if (agreedNotClaimed.length) {
      parts.push(
        "AGREED BUT NOT CLAIMED (they said yes; their page is still unclaimed):\n" +
          agreedNotClaimed
            .map((l) =>
              [
                `lead_id: ${l.id}`,
                `name: ${l.name}`,
                `status: ${l.status}`,
                `email: ${l.email ?? "none"}`,
                `claim page: ${l.claimUrl}`,
                `last touched: ${l.lastOutreachAt?.toISOString().slice(0, 10) ?? "never"}`,
              ].join(" · "),
            )
            .join("\n"),
      );
    }
    if (stalledReadiness.length) {
      parts.push(
        "CLAIMED BUT NOT BOOKABLE (their booking system is not through yet):\n" +
          stalledReadiness
            .map((r) =>
              [
                `readiness_id: ${r.id}`,
                `name: ${r.operatorProfile?.companyName ?? "(no company name)"}`,
                `platform: ${r.platform}`,
                `state: ${r.status}`,
                `waiting on: ${READINESS_BLOCKER[r.status] ?? "unknown"}`,
                `email: ${r.contactEmail ?? "none"}`,
                `unchanged since: ${r.updatedAt.toISOString().slice(0, 10)}`,
              ].join(" · "),
            )
            .join("\n"),
      );
    }
    return parts.join("\n\n");
  },
};

const sendClaimInvite: AgentTool = {
  name: "send_claim_invite",
  description:
    "Send an operator who has agreed the link to claim their page. The draft must have passed verify_outbound in this run. It must contain their own claim link. You never claim on their behalf.",
  schema: z.object({
    lead_id: z.string().min(1),
    channel: z.enum(["email", "whatsapp"]),
    subject: z.string().max(140).optional(),
    body: z.string().min(30).max(1500),
  }),
  writes: true,
  run: async (input, ctx) => {
    const verifications = (ctx.outcome.verifications as { pass: boolean }[] | undefined) ?? [];
    if (verifications.length === 0 || !verifications[verifications.length - 1].pass) {
      return "Refused: the copy rules have not passed on this message. Run verify_outbound first.";
    }
    const lead = await prisma.operatorLead.findUnique({
      where: { id: input.lead_id },
      select: { id: true, slug: true, name: true, email: true, phone: true, claimUrl: true, status: true },
    });
    if (!lead) return `No lead ${input.lead_id}.`;
    if (!lead.claimUrl) return `${lead.name} has no claim page yet. Do not message them.`;
    if (!input.body.includes(lead.claimUrl)) {
      return "Refused: the message does not contain this operator's own claim link, which is the only thing it is for.";
    }

    const to = input.channel === "email" ? lead.email : lead.phone;
    if (!to) return `${lead.name} has no ${input.channel} address on file.`;

    const result = await dispatch({
      channel: input.channel,
      to,
      subject: input.subject,
      body: input.body,
      reference: `lead:${lead.id}`,
    });
    const sent = result.status === "sent";

    await logLeadEvent({
      leadId: lead.id,
      slug: lead.slug,
      type: "agent.claim_invited",
      message: input.body,
      metadata: {
        channel: input.channel,
        status: result.status,
        agentId: ONBOARDER_ID,
        runId: ctx.runId,
      },
      touched: sent,
      now: ctx.now,
    });
    if (sent && lead.status === "IN_DISCUSSION") {
      await prisma.operatorLead.update({
        where: { id: lead.id },
        data: { status: "CLAIM_LINK_REQUESTED" },
      });
    }

    return sent
      ? `Claim link sent to ${lead.name} on ${input.channel}.`
      : `Prepared for ${lead.name} and saved on their log. ${result.status === "prepared" ? result.reason : ""}`;
  },
};

const nudgeReadiness: AgentTool = {
  name: "nudge_connection",
  description:
    "Message a claimed operator about the one thing blocking their booking system, and record the nudge. The draft must have passed verify_outbound in this run. Never use this on a readiness in MANUAL_REVIEW.",
  schema: z.object({
    readiness_id: z.string().min(1),
    channel: z.enum(["email", "whatsapp"]),
    subject: z.string().max(140).optional(),
    body: z.string().min(30).max(1500),
  }),
  writes: true,
  run: async (input, ctx) => {
    const verifications = (ctx.outcome.verifications as { pass: boolean }[] | undefined) ?? [];
    if (verifications.length === 0 || !verifications[verifications.length - 1].pass) {
      return "Refused: the copy rules have not passed on this message. Run verify_outbound first.";
    }
    const readiness = await prisma.operatorPmsReadiness.findUnique({
      where: { id: input.readiness_id },
      select: {
        id: true,
        status: true,
        platform: true,
        contactEmail: true,
        contactWhatsapp: true,
        notes: true,
        operatorProfile: { select: { companyName: true } },
      },
    });
    if (!readiness) return `No readiness record ${input.readiness_id}.`;
    if (readiness.status === "MANUAL_REVIEW") {
      return "Refused: this one is in manual review. A person handles it; do not message the operator.";
    }
    if (readiness.status === "SYNCED") {
      return "Refused: they are already connected and synced. Nothing to chase.";
    }

    const to = input.channel === "email" ? readiness.contactEmail : readiness.contactWhatsapp;
    if (!to) return `No ${input.channel} address on this readiness record.`;

    const result = await dispatch({
      channel: input.channel,
      to,
      subject: input.subject,
      body: input.body,
      reference: `readiness:${readiness.id}`,
    });

    const note = `${ctx.now.toISOString().slice(0, 10)} · onboarder nudge (${readiness.status}, ${result.status})`;
    await prisma.operatorPmsReadiness.update({
      where: { id: readiness.id },
      data: { notes: readiness.notes ? `${readiness.notes}\n${note}` : note },
    });

    const done = (ctx.outcome.nudged as unknown[] | undefined) ?? [];
    ctx.outcome.nudged = [...done, { readinessId: readiness.id, status: result.status }];
    ctx.log(`${readiness.operatorProfile?.companyName ?? readiness.id}: nudged at ${readiness.status}`);

    return result.status === "sent"
      ? `Nudged ${readiness.operatorProfile?.companyName ?? "the operator"} about ${readiness.status}.`
      : `Prepared a nudge and recorded it on the readiness note. ${result.reason}`;
  },
};

const escalateStuck: AgentTool = {
  name: "escalate_stuck_operator",
  description:
    "Raise an operator who is stuck in a way a message will not fix: BluePass owes them something, the connection keeps failing, or they have been chased twice with no movement.",
  schema: z.object({
    who: z.string().max(140).describe("The operator's name."),
    entity_type: z.enum(["OperatorLead", "OperatorPmsReadiness"]),
    entity_id: z.string().min(1),
    what_is_stuck: z.string().max(500),
  }),
  writes: true,
  run: async (input, ctx) => {
    const r = await ctx.requestDecision({
      kind: "onboarding.stuck",
      title: `${input.who} is stuck in onboarding`,
      summary: input.what_is_stuck,
      payload: { entityType: input.entity_type, entityId: input.entity_id },
      entityType: input.entity_type,
      entityId: input.entity_id,
    });
    return `Raised for a person (decision ${r.decisionId}). Do not chase them again in the meantime.`;
  },
};

export const onboarderAgent: AgentDefinition = {
  id: ONBOARDER_ID,
  name: "Onboarder",
  desk: "supply",
  plane: "operating",
  wave: 1,
  modelTier: "reasoning",
  persona: `You are the Onboarder for BluePass, a marine-tourism booking marketplace in Australia and Indonesia. Operators who have already said yes get stuck part way, and your job is to move them one concrete step.

There are two kinds of stuck.

An operator who agreed but has not claimed their page. Send them the claim link, once, warmly and briefly. The link is the whole message. If they have already been chased and still have not claimed, do not chase a third time: raise it for a person.

A claimed operator whose booking system is not through yet. Each state is waiting on exactly one thing, and the list tells you which. Write about that one thing. Do not send a general reminder that they have not finished; nobody acts on those, and it reads as nagging. If the thing that is missing is on BluePass rather than on them, say so plainly. Operators forgive a delay they are told about.

What you never do:
- You never claim a page for an operator, never fill in their details, and never submit credentials on their behalf. Claiming binds an account to a real business, and doing that for them would be impersonation in the one flow where identity matters most.
- You never tell them their trips are live, that a booking is coming, or when they will be bookable. You do not know any of that.
- You never touch anyone in manual review.

Rules you cannot bend:
- Run verify_outbound on the exact text before every message.
- Never state a percentage except the fixed 5% of every booking that goes to ocean conservation.
- No price-match promise, no "keep everything", no emojis, no em dashes.
- One message per operator per run.

Work the list. Where a message will not fix it, escalate instead of writing one.`,
  triggers: [{ type: "schedule", cadence: "daily" }, { type: "manual" }],
  tools: [listStalled, verifyOutbound, sendClaimInvite, nudgeReadiness, escalateStuck],
  gates: [{ kind: "onboarding.stuck", assignee: "kirby", defaultAction: "hold", ttlHours: 48 }],
  budget: { maxRunsPerDay: 6, maxTokensPerRun: 16_000, maxIterations: 40 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) {
      return { skip: "a stuck operator was answered by a person; nothing for the Onboarder to redo" };
    }
    ctx.log("looking for stalled operators");
    return {
      task: `Move the operators who have stalled in onboarding.

Start with list_operators_to_move. For each one, write the single most useful message for where they actually are, verify it, and send it. Where a message will not help, escalate instead. If the list is empty, stop.`,
    };
  },
};
