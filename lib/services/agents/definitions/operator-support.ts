/**
 * Agent 10 · Operator support (Wave 2).
 *
 * The operator's side of the conversation once they are on the platform.
 * Answers what they ask, and once a month tells them where they stand
 * without being asked.
 *
 * The line this agent walks is narrow. An operator asking "where is my
 * money" needs a real answer, and the only honest source is the ledger.
 * This app is not the ledger. So the agent answers what it can see here,
 * says plainly what it cannot see, and routes the rest to a person rather
 * than reassuring someone about money it cannot actually account for.
 *
 * Getting that wrong is the single fastest way to lose an operator, so the
 * agent is built to under-claim rather than to sound helpful.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { dispatch } from "../tools/dispatch";
import { verifyOutbound } from "./verifier";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const OPERATOR_SUPPORT_ID = "operator-support";

const operatorStanding: AgentTool = {
  name: "read_operator_standing",
  description:
    "Everything this app knows about one operator: their status, their listings, their booking-system connection and their payout setup. Call this before answering anything. It does not include money owed; that lives elsewhere.",
  schema: z.object({ profile_id: z.string().min(1) }),
  run: async (input, ctx) => {
    const p = await prisma.operatorProfile.findUnique({
      where: { id: input.profile_id },
      select: {
        id: true,
        companyName: true,
        status: true,
        websiteUrl: true,
        claimedAt: true,
        country: true,
        payoutMethod: true,
        stripeConnectAccountId: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        payoutContactEmail: true,
        cancellationPolicyTiers: true,
        account: { select: { email: true, displayName: true } },
        pmsReadiness: { select: { platform: true, status: true, notes: true, updatedAt: true } },
        listings: {
          select: { title: true, status: true, priceSignal: true, externalProductId: true },
          take: 30,
        },
      },
    });
    if (!p) return `No operator profile ${input.profile_id}.`;

    const live = p.listings.filter((l) => l.status === "LIVE");
    const draft = p.listings.filter((l) => l.status === "DRAFT");
    ctx.outcome.profileId = p.id;

    return [
      `${p.companyName ?? "(no company name)"} · application status ${p.status}`,
      `Contact: ${p.account?.email ?? "none"}`,
      `Claimed: ${p.claimedAt?.toISOString().slice(0, 10) ?? "not yet"}`,
      `Country on file: ${p.country ?? "NOT SET"}`,
      "",
      `Booking system: ${p.pmsReadiness ? `${p.pmsReadiness.platform}, state ${p.pmsReadiness.status}` : "none connected"}`,
      p.pmsReadiness?.notes ? `Connection notes: ${p.pmsReadiness.notes.slice(-300)}` : "",
      "",
      `Listings: ${live.length} live, ${draft.length} in draft`,
      ...live.slice(0, 10).map((l) => `  LIVE · ${l.title}${l.priceSignal ? ` · ${l.priceSignal}` : " · NO PRICE"}${l.externalProductId ? " · synced" : " · written by them"}`),
      ...draft.slice(0, 6).map((l) => `  DRAFT · ${l.title}`),
      "",
      `Payout method: ${p.payoutMethod}`,
      `Stripe Connect: ${p.stripeConnectAccountId ? `connected, charges ${p.stripeChargesEnabled ? "on" : "OFF"}, payouts ${p.stripePayoutsEnabled ? "on" : "OFF"}` : "not set up"}`,
      `Cancellation policy set by them: ${p.cancellationPolicyTiers ? "yes" : "no, so the platform default applies"}`,
      "",
      "NOT IN THIS RECORD: bookings taken, money held, money paid, or anything owed. Those live in the booking backend, and you cannot see them from here. Say so rather than guessing.",
    ]
      .filter(Boolean)
      .join("\n");
  },
};

const answerOperator: AgentTool = {
  name: "answer_operator",
  description:
    "Reply to an operator. The draft must have passed verify_outbound in this run. Only answer from what read_operator_standing returned.",
  schema: z.object({
    profile_id: z.string().min(1),
    channel: z.enum(["email", "whatsapp"]),
    subject: z.string().max(140).optional(),
    body: z.string().min(20).max(2000),
  }),
  writes: true,
  run: async (input, ctx) => {
    const verifications = (ctx.outcome.verifications as { pass: boolean }[] | undefined) ?? [];
    if (verifications.length === 0 || !verifications[verifications.length - 1].pass) {
      return "Refused: the copy rules have not passed on this reply. Run verify_outbound on the exact text first.";
    }
    const p = await prisma.operatorProfile.findUnique({
      where: { id: input.profile_id },
      select: { id: true, companyName: true, whatsappE164: true, account: { select: { email: true } } },
    });
    if (!p) return `No operator profile ${input.profile_id}.`;

    const to = input.channel === "email" ? p.account?.email : p.whatsappE164;
    if (!to) return `No ${input.channel} address on file for ${p.companyName ?? "this operator"}.`;

    const result = await dispatch({
      channel: input.channel,
      to,
      subject: input.subject,
      body: input.body,
      reference: `operator:${p.id}`,
    });
    ctx.log(`answered ${p.companyName ?? p.id} on ${input.channel}`);
    return result.status === "sent"
      ? `Replied to ${p.companyName ?? "the operator"}.`
      : `Prepared a reply and saved it. ${result.reason}`;
  },
};

const escalateToPerson: AgentTool = {
  name: "escalate_to_person",
  description:
    "Route to a person. Use for anything about money owed, a booking dispute, a complaint, a request to leave, or anything you cannot answer from the record. Preferred over a vague reassurance, always.",
  schema: z.object({
    profile_id: z.string().min(1),
    who: z.string().max(140),
    what_they_asked: z.string().max(500),
    why_you_cannot_answer: z.string().max(400),
    urgency: z.enum(["normal", "high"]),
  }),
  writes: true,
  run: async (input, ctx) => {
    const r = await ctx.requestDecision({
      kind: "operator.needs_person",
      title: `${input.who}: ${input.urgency === "high" ? "needs you today" : "needs a person"}`,
      summary: `They asked: ${input.what_they_asked}\n\nWhy this cannot be answered from the operator record: ${input.why_you_cannot_answer}`,
      payload: { profileId: input.profile_id, urgency: input.urgency },
      entityType: "OperatorProfile",
      entityId: input.profile_id,
      ttlHours: input.urgency === "high" ? 8 : 24,
    });
    ctx.outcome.escalated = true;
    return `Raised for a person (decision ${r.decisionId}). Send the operator a short honest holding line if you have not already: say a person is looking at it, and do not guess at the answer.`;
  },
};

const listForStatements: AgentTool = {
  name: "list_operators_for_statement",
  description:
    "List live operators who should get their monthly standing note. Use only on the monthly run.",
  schema: z.object({ limit: z.number().int().min(1).max(40).optional() }),
  run: async (input, ctx) => {
    const ops = await prisma.operatorProfile.findMany({
      where: { status: { in: ["APPROVED", "LIVE"] } },
      orderBy: { updatedAt: "asc" },
      take: input.limit ?? 20,
      select: {
        id: true, companyName: true,
        pmsReadiness: { select: { platform: true, status: true } },
        listings: { select: { status: true }, take: 50 },
        stripePayoutsEnabled: true,
      },
    });
    ctx.outcome.statementBatch = ops.length;
    if (ops.length === 0) return "No live operators yet. Nothing to send.";
    return ops
      .map((o) => {
        const live = o.listings.filter((l) => l.status === "LIVE").length;
        return `profile_id: ${o.id} · ${o.companyName ?? "(unnamed)"} · ${live} live listings · connection ${o.pmsReadiness?.status ?? "none"} · payouts ${o.stripePayoutsEnabled ? "ready" : "NOT SET UP"}`;
      })
      .join("\n");
  },
};

export const operatorSupportAgent: AgentDefinition = {
  id: OPERATOR_SUPPORT_ID,
  name: "Operator support",
  desk: "operators",
  plane: "product",
  wave: 2,
  modelTier: "reasoning",
  persona: `You are operator support for BluePass, a marine-tourism marketplace in Australia and Indonesia. You talk to operators who are already on the platform.

The most important thing about this job is what you cannot see. This record holds an operator's status, their listings, their booking-system connection and their payout setup. It does not hold their bookings, the money held for them, or anything owed. That lives in the booking backend, which you have no access to.

So when an operator asks where their money is, you do not reassure them. You say plainly that you can see their payout setup but not their balance, that a person is looking at it, and you escalate. An operator who is told "everything looks fine" about money that has not arrived stops trusting BluePass permanently, and they tell the other operators, and the marine industry in both markets is small. Under-claiming costs a day. Over-claiming costs the operator.

What you can genuinely help with:
- Why their listings are not showing: draft status, no price, no connection.
- What their booking-system connection is waiting on, and whether that is on them or on BluePass. Say which honestly.
- What their payout setup still needs before money could reach them.
- Their own cancellation policy, or the fact that the platform default applies because they have not set one.

Escalate without hesitating on: money owed, a booking dispute, a complaint about a guest or a trip, anything legal, and any request to leave the platform. A request to leave is never something to talk someone out of. Pass it on.

How to write:
- Answer the question in the first sentence.
- Three or four sentences. They are running boats.
- If something is BluePass's fault, say so without excuses.
- Never say a booking is coming, never estimate when they will be live, never quote a figure of any kind other than the fixed 5% of every booking that goes to ocean conservation.

On the monthly run, send each live operator a short note on where they stand: what is live, what the connection is waiting on, what is still missing from their payout setup. No numbers about money.

Rules you cannot bend: run verify_outbound on the exact text before every message; no emojis; no em dashes; never claim to be a person.`,
  triggers: [
    { type: "event", pattern: "operator.message_received" },
    { type: "schedule", cadence: "monthly" },
    { type: "manual" },
  ],
  tools: [operatorStanding, listForStatements, verifyOutbound, answerOperator, escalateToPerson],
  gates: [{ kind: "operator.needs_person", assignee: "kirby", defaultAction: "hold", ttlHours: 24 }],
  budget: { maxRunsPerDay: 60, maxTokensPerRun: 12_000, maxIterations: 16 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) return { skip: "a person answered this operator" };

    if (payload.cadence === "monthly") {
      ctx.log("monthly operator statements");
      return {
        task: `Send this month's standing note to live operators.

Start with list_operators_for_statement. For each, read their standing, write a short honest note about what is live and what is still waiting, verify it and send it. No figures about money.`,
      };
    }

    const profileId = (payload.entityId as string) ?? (payload.profileId as string | undefined);
    const message = typeof payload.message === "string" ? payload.message : null;
    if (!profileId) return { skip: "no operator on the trigger" };
    if (!message) return { skip: "no message text on the trigger" };
    ctx.log(`answering operator ${profileId}`);

    return {
      task: `An operator has written in. Their message, exactly as received:

--- MESSAGE START ---
${message}
--- MESSAGE END ---

Read their standing first (profile ${profileId}). Answer only what the record supports. Anything about money owed, a dispute, a complaint or leaving the platform goes to a person.`,
    };
  },
};
