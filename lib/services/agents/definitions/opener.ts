/**
 * Agent 03 · Opener (Wave 1).
 *
 * Writes the first touch, one operator at a time, from what the Scout found
 * about them. The opener that works is specific: their own system, their
 * own water, their page already built. A template with the name swapped in
 * is what everyone else sends.
 *
 * Every draft goes through the copy rules before it can leave. Email is the
 * only channel an agent may send on; Instagram and WhatsApp drafts are
 * prepared for a person, because automating cold outreach there gets the
 * account banned and BluePass needs those channels more than it needs the
 * send.
 *
 * It only touches leads the Scout has assessed and only ones with a page
 * live to claim. A first impression that lands on a dead link cannot be
 * taken back.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { logLeadEvent } from "../tools/lead-log";
import { dispatch, dispatcherWired } from "../tools/dispatch";
import { verifyOutbound } from "./verifier";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const OPENER_ID = "opener";

const BATCH = 6;

const listReady: AgentTool = {
  name: "list_leads_ready_for_first_touch",
  description:
    "List assessed leads that have never been contacted, best first. Returns what the Scout found and what BluePass can reach them on. Call this first.",
  schema: z.object({
    region: z.string().max(60).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  run: async (input, ctx) => {
    const leads = await prisma.operatorLead.findMany({
      where: {
        status: "IMPORTED",
        lastOutreachAt: null,
        claimUrl: { not: null },
        ...(input.region ? { region: { contains: input.region, mode: "insensitive" as const } } : {}),
        outreachEvents: { some: { type: "agent.platform_assessed" } },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        region: true,
        category: true,
        email: true,
        phone: true,
        claimUrl: true,
        websiteUrl: true,
        outreachEvents: {
          where: { type: "agent.platform_assessed" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { metadata: true },
        },
      },
      take: 60,
    });

    const scored = leads
      .map((l) => {
        const m = (l.outreachEvents[0]?.metadata ?? {}) as Record<string, unknown>;
        return { lead: l, priority: Number(m.priority ?? 0), platform: String(m.platform ?? "unknown"), path: String(m.path ?? "unknown") };
      })
      .filter((x) => x.priority > 0)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, input.limit ?? BATCH);

    ctx.outcome.batch = scored.map((s) => s.lead.id);
    if (scored.length === 0) {
      return "No assessed, uncontacted leads with a live claim page. Nothing to do; end the turn.";
    }

    return scored
      .map((s) =>
        [
          `id: ${s.lead.id}`,
          `name: ${s.lead.name}`,
          `region: ${s.lead.region ?? "unknown"}`,
          `category: ${s.lead.category ?? "unknown"}`,
          `platform: ${s.platform} (${s.path})`,
          `priority: ${s.priority}`,
          `email: ${s.lead.email ?? "none"}`,
          `phone: ${s.lead.phone ?? "none"}`,
          `claim page: ${s.lead.claimUrl}`,
        ].join(" · "),
      )
      .join("\n");
  },
};

const sendFirstTouch: AgentTool = {
  name: "send_first_touch",
  description:
    "Send or prepare the first touch for one lead. The draft must already have passed verify_outbound in this run. Email is sent when a sender is wired; Instagram and WhatsApp are always prepared for a person. Call once per lead.",
  schema: z.object({
    lead_id: z.string().min(1),
    channel: z.enum(["email", "whatsapp", "instagram"]),
    subject: z.string().max(140).optional().describe("Email only. Plain, specific, no marketing voice."),
    body: z.string().min(40).max(2000).describe("The exact message, as verified."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const verifications = (ctx.outcome.verifications as { pass: boolean }[] | undefined) ?? [];
    if (verifications.length === 0 || !verifications[verifications.length - 1].pass) {
      return "Refused: the copy rules have not passed on this draft. Run verify_outbound on the exact text first, fix anything it blocks, then call this again.";
    }

    const lead = await prisma.operatorLead.findUnique({
      where: { id: input.lead_id },
      select: { id: true, slug: true, name: true, email: true, phone: true, claimUrl: true, status: true },
    });
    if (!lead) return `No lead ${input.lead_id}. Skip it.`;
    if (lead.status !== "IMPORTED") {
      return `${lead.name} is already at ${lead.status}, so the first touch has been handled. Skip it.`;
    }
    if (!lead.claimUrl) {
      return `${lead.name} has no live claim page. Do not contact them: a dead link in a first message cannot be undone.`;
    }
    if (!input.body.includes(lead.claimUrl)) {
      return "Refused: the message does not contain this lead's own claim link. The whole opener is that their page is already built, so the link has to be in it.";
    }

    const to = input.channel === "email" ? lead.email : lead.phone;
    if (!to) return `${lead.name} has no ${input.channel} address on file. Try another channel or skip.`;

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
      type: sent ? "agent.first_touch_sent" : "agent.first_touch_drafted",
      message: input.body,
      metadata: {
        channel: input.channel,
        subject: input.subject ?? null,
        status: result.status,
        reason: result.status === "prepared" ? result.reason : null,
        agentId: OPENER_ID,
        runId: ctx.runId,
      },
      touched: sent,
      now: ctx.now,
    });

    if (sent) {
      await prisma.operatorLead.update({ where: { id: lead.id }, data: { status: "CONTACTED" } });
    }

    const done = (ctx.outcome.touched as unknown[] | undefined) ?? [];
    ctx.outcome.touched = [...done, { leadId: lead.id, channel: input.channel, status: result.status }];
    ctx.log(`${lead.name}: first touch ${result.status} on ${input.channel}`);

    return sent
      ? `Sent to ${lead.name} on ${input.channel}. Lead moved to CONTACTED.`
      : `Prepared for ${lead.name} on ${input.channel} and saved on their outreach log. ${result.status === "prepared" ? result.reason : ""} The lead stays at IMPORTED until it actually goes out.`;
  },
};

export const openerAgent: AgentDefinition = {
  id: OPENER_ID,
  name: "Opener",
  desk: "supply",
  managedBy: "supply-manager",
  plane: "operating",
  wave: 1,
  modelTier: "reasoning",
  persona: `You are the Opener for BluePass, a marine-tourism booking marketplace in Australia and Indonesia. You write the first message an operator ever gets from BluePass.

What you are offering, in plain terms:
- Their BluePass page is already built. The claim link in your message is theirs.
- They set their own rates. BluePass never marks them up, and listing is free.
- BluePass only earns when it brings them a booking.
- A fixed 5% of every booking goes to ocean conservation, in the water they work in.
- If they run a booking system BluePass can connect to, their real trips and availability flow through automatically and they change nothing.

How to write it:
- Open with something only true of this operator: their own booking system, their own reef or coast, the kind of trip they run. If your first line would work for any other operator, it is wrong.
- Short. Four or five sentences. It is read on a phone between trips.
- Plain and direct, the way one operator writes to another. No marketing voice, no adjectives stacked up, no exclamation marks.
- One ask: claim the page. The link goes in the message.
- A Rezdy operator can be live the same day, and that is worth saying. An operator on a system BluePass cannot connect to gets the honest version: they can take enquiries through BluePass now, and connect properly later. Never imply an integration that does not exist.

Rules you cannot bend:
- Run verify_outbound on the exact text before every send_first_touch. If it blocks, rewrite and check again. Never send unverified text.
- Never state any percentage except the 5% to the ocean.
- Never promise a price match, and never say an operator keeps everything.
- No emojis, no em dashes.
- Instagram and WhatsApp are prepared for a person, never sent by you. Write them just as carefully; someone is going to paste them.

Work the batch in the order given: the list is already ranked. One message per lead.`,
  triggers: [{ type: "schedule", cadence: "daily" }, { type: "manual" }],
  tools: [listReady, verifyOutbound, sendFirstTouch],
  gates: [],
  budget: { maxRunsPerDay: 6, maxTokensPerRun: 16_000, maxIterations: 40 },
  buildTask: async (payload, ctx: RunContext) => {
    const region = typeof payload.region === "string" ? payload.region : null;
    ctx.log(dispatcherWired() ? "sender wired: email will send" : "no sender wired: drafts will be prepared only");
    return {
      task: `Write the first touch for the next batch of operator leads${region ? ` in ${region}` : ""}.

Start with list_leads_ready_for_first_touch. For each lead, write the message, run verify_outbound on it, then call send_first_touch. ${dispatcherWired() ? "Email will be sent." : "No sender is wired, so these will be saved as prepared drafts. Write them as if they are going out, because they are."}

If the list is empty, stop.`,
    };
  },
};
