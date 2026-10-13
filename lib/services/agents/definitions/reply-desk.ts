/**
 * Agent 04 · Reply desk (Wave 1).
 *
 * Reads what an operator wrote back and decides what it means: they are
 * interested, they have a question, they have an objection, it is the wrong
 * time, or it is a no. Then it moves the lead and answers where an answer
 * is warranted.
 *
 * The consequential half of this job is the no. A no is permanent, it is
 * recorded so nothing in the system ever contacts them again, and it is
 * never argued with. An operator who was pestered after saying no is an
 * operator BluePass cannot approach in two years when they change systems,
 * and the marine industry in both markets is small enough that they will
 * tell the others.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { logLeadEvent, leadHistory } from "../tools/lead-log";
import { dispatch } from "../tools/dispatch";
import { verifyOutbound } from "./verifier";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const REPLY_DESK_ID = "reply-desk";

/** What a reply means, and where the lead goes because of it. */
const CLASSIFICATIONS = {
  interested: "IN_DISCUSSION",
  question: "IN_DISCUSSION",
  objection: "IN_DISCUSSION",
  not_now: "CONTACTED",
  no: "DECLINED",
  wrong_person: "MANUAL_REVIEW",
  unclear: "MANUAL_REVIEW",
} as const;

type Classification = keyof typeof CLASSIFICATIONS;

const readThread: AgentTool = {
  name: "read_lead_thread",
  description:
    "Read what BluePass has already said to this operator and what they said back. Call this before classifying, so you answer in context rather than from the last message alone.",
  schema: z.object({ lead_id: z.string().min(1) }),
  run: async (input) => {
    const lead = await prisma.operatorLead.findUnique({
      where: { id: input.lead_id },
      select: { id: true, name: true, status: true, region: true, category: true, claimUrl: true },
    });
    if (!lead) return `No lead ${input.lead_id}.`;

    const events = await leadHistory(lead.id, 15);
    const lines = events
      .reverse()
      .map((e) => {
        const when = e.createdAt.toISOString().slice(0, 10);
        return `${when} · ${e.type}${e.message ? `: ${e.message.slice(0, 400)}` : ""}`;
      })
      .join("\n");

    return [
      `${lead.name} · ${lead.region ?? "region unknown"} · ${lead.category ?? "category unknown"}`,
      `Current status: ${lead.status}`,
      `Claim page: ${lead.claimUrl ?? "none"}`,
      "",
      "History, oldest first:",
      lines || "(nothing logged yet)",
    ].join("\n");
  },
};

const classifyReply: AgentTool = {
  name: "classify_reply",
  description:
    "Record what the reply means and move the lead. Call once. 'no' is permanent and suppresses the lead from all future outreach. Use 'unclear' rather than guessing.",
  schema: z.object({
    lead_id: z.string().min(1),
    classification: z.enum([
      "interested",
      "question",
      "objection",
      "not_now",
      "no",
      "wrong_person",
      "unclear",
    ]),
    reasoning: z.string().max(400).describe("One line: what in their words told you this."),
    objection: z
      .string()
      .max(200)
      .optional()
      .describe("For an objection, the thing they are actually worried about, in their words."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const lead = await prisma.operatorLead.findUnique({
      where: { id: input.lead_id },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (!lead) return `No lead ${input.lead_id}.`;

    const classification = input.classification as Classification;
    const nextStatus = CLASSIFICATIONS[classification];

    await prisma.operatorLead.update({
      where: { id: lead.id },
      data: { status: nextStatus },
    });
    await logLeadEvent({
      leadId: lead.id,
      slug: lead.slug,
      type: classification === "no" ? "agent.suppressed" : "agent.reply_classified",
      message: input.reasoning,
      metadata: {
        classification,
        objection: input.objection ?? null,
        fromStatus: lead.status,
        toStatus: nextStatus,
        agentId: REPLY_DESK_ID,
        runId: ctx.runId,
      },
    });

    ctx.outcome.classification = classification;
    ctx.outcome.leadId = lead.id;
    ctx.log(`${lead.name}: ${classification} → ${nextStatus}`);

    if (classification === "no") {
      return `Recorded as a no. ${lead.name} is DECLINED and suppressed: nothing contacts them again. Send no reply beyond a short acknowledgement if one is warranted, and do not argue.`;
    }
    if (classification === "wrong_person" || classification === "unclear") {
      const r = await ctx.requestDecision({
        kind: "reply.needs_person",
        title: `${lead.name}: reply needs a person`,
        summary: `${input.reasoning}\n\nClassified as ${classification}, so the lead is in manual review rather than being answered by an agent.`,
        payload: { leadId: lead.id, classification },
        entityType: "OperatorLead",
        entityId: lead.id,
      });
      return `Moved to MANUAL_REVIEW and raised for a person (decision ${r.decisionId}). Do not reply yourself.`;
    }
    return `Recorded as ${classification}. ${lead.name} moved to ${nextStatus}. Now answer them with reply_to_operator, or stop if no answer is warranted.`;
  },
};

const replyToOperator: AgentTool = {
  name: "reply_to_operator",
  description:
    "Answer the operator. The draft must have passed verify_outbound in this run. Use only after classify_reply, and never for a 'no', 'wrong_person' or 'unclear'.",
  schema: z.object({
    lead_id: z.string().min(1),
    channel: z.enum(["email", "whatsapp"]),
    subject: z.string().max(140).optional(),
    body: z.string().min(20).max(2000),
  }),
  writes: true,
  run: async (input, ctx) => {
    // Order matters. A no is checked before anything else, because no
    // amount of well-formed copy makes it acceptable to send: rewriting the
    // draft would satisfy the copy rules and still be the wrong outcome.
    if (ctx.outcome.classification === "no") {
      return "Refused: this operator said no. Nothing further goes to them.";
    }
    const verifications = (ctx.outcome.verifications as { pass: boolean }[] | undefined) ?? [];
    if (verifications.length === 0 || !verifications[verifications.length - 1].pass) {
      return "Refused: the copy rules have not passed on this reply. Run verify_outbound on the exact text first.";
    }

    const lead = await prisma.operatorLead.findUnique({
      where: { id: input.lead_id },
      select: { id: true, slug: true, name: true, email: true, phone: true },
    });
    if (!lead) return `No lead ${input.lead_id}.`;

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
      type: "agent.follow_up_sent",
      message: input.body,
      metadata: {
        channel: input.channel,
        status: result.status,
        reason: result.status === "prepared" ? result.reason : null,
        agentId: REPLY_DESK_ID,
        runId: ctx.runId,
      },
      touched: sent,
      now: ctx.now,
    });

    return sent
      ? `Replied to ${lead.name} on ${input.channel}.`
      : `Prepared a reply for ${lead.name} and saved it on their log. ${result.status === "prepared" ? result.reason : ""}`;
  },
};

export const replyDeskAgent: AgentDefinition = {
  id: REPLY_DESK_ID,
  name: "Reply desk",
  desk: "supply",
  managedBy: "supply-manager",
  plane: "operating",
  wave: 1,
  modelTier: "reasoning",
  persona: `You are the Reply desk for BluePass, a marine-tourism booking marketplace in Australia and Indonesia. An operator has written back to a first touch. You work out what they mean and answer them.

Read the thread first. Then classify, then answer.

What the classifications mean:
- interested: they want to know how to start, or they have claimed, or they said yes.
- question: they want something explained before they decide. Answer it.
- objection: they have a specific worry. Commission, another OTA burning them, their system, time, trust, whether this is real.
- not_now: the door is open but the timing is wrong. Season, a boat out of the water, too busy.
- no: they do not want this. Take it at face value.
- wrong_person: you are talking to someone who cannot decide, or the business is not what the record says.
- unclear: you genuinely cannot tell. Use it rather than guessing.

What you can tell them, and nothing beyond it:
- Their page is already built and the claim link is theirs.
- They set their own rates. BluePass never marks them up. Listing is free.
- BluePass earns only when it brings a booking. If they ask what the commission is, say it is agreed with them before anything goes live and that a person will give them the number. Never state a figure yourself.
- A fixed 5% of every booking goes to ocean conservation.
- If they run a system BluePass connects to, their real trips and availability flow automatically.
- You do not know their dates, their prices, their capacity, or when they would be live. If they ask something you cannot answer from the thread, say a person will come back on it rather than inventing an answer.

How to answer:
- Answer the thing they asked, first sentence. No preamble, no thanking them for their interest.
- Short. Three or four sentences.
- An objection gets acknowledged honestly, not deflected. If BluePass genuinely cannot do something, say so.
- Never argue with a no, and never send anything further to one.

Rules you cannot bend:
- Run verify_outbound on the exact text before every reply.
- Never state a percentage except the 5% to the ocean.
- No price-match promise, no "keep everything", no emojis, no em dashes.
- Never claim to be a person. If they ask, say you are BluePass's assistant and a teammate is reading along.`,
  triggers: [{ type: "event", pattern: "operator.reply_received" }, { type: "manual" }],
  tools: [readThread, classifyReply, verifyOutbound, replyToOperator],
  gates: [{ kind: "reply.needs_person", assignee: "kirby", defaultAction: "hold", ttlHours: 24 }],
  budget: { maxRunsPerDay: 100, maxTokensPerRun: 8000, maxIterations: 12 },
  buildTask: async (payload, ctx: RunContext) => {
    const leadId = (payload.entityId as string) ?? (payload.leadId as string | undefined);
    const message = typeof payload.message === "string" ? payload.message : null;
    if (!leadId) return { skip: "no lead id on the trigger" };
    if (!message) return { skip: "no reply text on the trigger" };

    const lead = await prisma.operatorLead.findUnique({
      where: { id: leadId },
      select: { name: true, status: true },
    });
    if (!lead) return { skip: `lead ${leadId} no longer exists` };
    if (lead.status === "DECLINED") {
      return { skip: "this operator already said no; nothing further goes to them" };
    }
    ctx.log(`handling reply from ${lead.name}`);

    return {
      task: `${lead.name} replied. Their message, exactly as received:

--- REPLY START ---
${message}
--- REPLY END ---

Read the thread with read_lead_thread (lead id ${leadId}), classify what they mean, then answer them if an answer is warranted.`,
    };
  },
};
