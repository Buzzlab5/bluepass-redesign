/**
 * Agent 02 · Scout (Wave 1).
 *
 * Works the lead list. For each operator lead BluePass holds but has not
 * assessed, it fetches the site, detects which booking system they actually
 * run, and records what that means for onboarding: connect today, wait on a
 * connector, blocked on someone else's approval, or Enquire only.
 *
 * The detection is deterministic code, not judgement. What the agent adds
 * is reading a site the signal table gets wrong: a closed business, a
 * broker rather than an operator, a booking button that goes somewhere
 * unexpected, two brands sharing a domain. Those are the cases that turn a
 * first impression into a wasted one, and they need a person.
 *
 * It writes an assessment onto the lead's own outreach log and ranks it. It
 * contacts nobody. The Opener works from what it ranks.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  BOOK_PATHS,
  assessPlatform,
  detectPlatform,
  scoreProspect,
  toPmsPlatform,
  type Platform,
} from "../tools/platform-detect";
import { logLeadEvent } from "../tools/lead-log";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const SCOUT_ID = "scout";

const BATCH = 8;
const FETCH_TIMEOUT_MS = 12_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const listUnassessed: AgentTool = {
  name: "list_unassessed_leads",
  description:
    "List operator leads that have not been assessed yet: name, region, website and whether an email or phone is on file. Call this first.",
  schema: z.object({
    region: z.string().max(60).optional().describe("Optional filter, e.g. 'Queensland'."),
  }),
  run: async (input, ctx) => {
    const leads = await prisma.operatorLead.findMany({
      where: {
        status: "IMPORTED",
        ...(input.region ? { region: { contains: input.region, mode: "insensitive" as const } } : {}),
        outreachEvents: { none: { type: "agent.platform_assessed" } },
      },
      orderBy: { createdAt: "asc" },
      take: BATCH,
      select: {
        id: true,
        slug: true,
        name: true,
        region: true,
        category: true,
        websiteUrl: true,
        email: true,
        phone: true,
      },
    });

    ctx.outcome.batch = leads.map((l) => l.id);
    if (leads.length === 0) return "No unassessed leads. Nothing to do; end the turn.";

    return leads
      .map((l) =>
        [
          `id: ${l.id}`,
          `slug: ${l.slug}`,
          `name: ${l.name}`,
          `region: ${l.region ?? "unknown"}`,
          `category: ${l.category ?? "unknown"}`,
          `website: ${l.websiteUrl ?? "(none on file)"}`,
          `email: ${l.email ? "yes" : "no"}`,
          `phone: ${l.phone ? "yes" : "no"}`,
        ].join(" · "),
      )
      .join("\n");
  },
};

const fetchSite: AgentTool = {
  name: "fetch_operator_site",
  description:
    "Fetch a lead's website and run BluePass's booking-platform detection over it. Tries the home page and the usual booking paths. Returns the detected system, the exact evidence string, and the page text so you can judge anything the detector could not. Never name a platform this did not return.",
  schema: z.object({
    lead_id: z.string().min(1),
    url: z.string().min(4).describe("The lead's website, as listed."),
  }),
  run: async (input, ctx) => {
    let base = input.url.trim();
    if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
    let origin: string;
    try {
      origin = new URL(base).origin;
    } catch {
      return `"${input.url}" is not a usable URL. Record the lead as unreachable with record_assessment.`;
    }

    const seen: string[] = [];
    let combined = "";
    let firstBody = "";
    for (const path of BOOK_PATHS) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(origin + path, {
          signal: ctrl.signal,
          headers: { "user-agent": UA, accept: "text/html" },
          redirect: "follow",
        });
        clearTimeout(timer);
        if (!res.ok) {
          seen.push(`${path || "/"} → ${res.status}`);
          continue;
        }
        const body = (await res.text()).slice(0, 400_000);
        seen.push(`${path || "/"} → 200`);
        combined += body;
        if (!firstBody) firstBody = body;
        const early = detectPlatform(body);
        if (
          early.platform !== "None detected" &&
          early.platform !== "WooCommerce" &&
          early.platform !== "Shopify"
        ) {
          break;
        }
      } catch (err) {
        seen.push(`${path || "/"} → ${err instanceof Error ? err.name : "failed"}`);
      }
    }

    if (!combined) {
      ctx.log(`${input.lead_id}: site unreachable`);
      return `Could not reach ${origin}. Paths tried: ${seen.join(", ")}. Record the lead as unreachable so a person can re-check the address.`;
    }

    const d = detectPlatform(combined);
    const a = assessPlatform(d.platform);
    const text = firstBody
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1200);

    return [
      `Detected: ${d.platform}${d.evidence ? ` (evidence: "${d.evidence}")` : ""}`,
      d.all.length > 1 ? `Also present: ${d.all.slice(1).map((x) => x.platform).join(", ")}` : null,
      `Onboarding path: ${a.path}. ${a.note}`,
      `Paths tried: ${seen.join(", ")}`,
      "",
      "Page text (first 1200 chars, for your judgement only):",
      text || "(no readable text)",
    ]
      .filter(Boolean)
      .join("\n");
  },
};

const recordAssessment: AgentTool = {
  name: "record_assessment",
  description:
    "Record what you found for one lead. Call once per lead, after fetch_operator_site. The platform must be one the detector returned, or 'None detected'.",
  schema: z.object({
    lead_id: z.string().min(1),
    platform: z.string().max(40).describe("Exactly as the detector named it, or 'None detected'."),
    evidence: z.string().max(200).nullable().optional(),
    warm_intro: z.boolean().optional().describe("True only when BluePass genuinely has an introduction."),
    looks_wrong: z
      .string()
      .max(400)
      .optional()
      .describe(
        "Set when the site contradicts the record: a closed business, a broker rather than an operator, a booking button going somewhere unexpected, two brands on one site, or not marine tourism at all.",
      ),
  }),
  writes: true,
  run: async (input, ctx) => {
    const lead = await prisma.operatorLead.findUnique({
      where: { id: input.lead_id },
      select: { id: true, slug: true, name: true, email: true, phone: true, region: true },
    });
    if (!lead) return `No lead ${input.lead_id}. Skip it.`;

    const platform = input.platform as Platform;
    const score = scoreProspect({
      platform,
      hasEmail: Boolean(lead.email),
      hasPhone: Boolean(lead.phone),
      warmIntro: input.warm_intro,
      region: lead.region,
    });

    const metadata = {
      platform,
      pmsPlatform: toPmsPlatform(platform),
      evidence: input.evidence ?? null,
      path: score.path,
      priority: score.priority,
      reasons: score.reasons,
      looksWrong: input.looks_wrong ?? null,
      assessedAt: ctx.now.toISOString(),
      agentId: SCOUT_ID,
      runId: ctx.runId,
    };

    await logLeadEvent({
      leadId: lead.id,
      slug: lead.slug,
      type: "agent.platform_assessed",
      message: `${platform} · ${score.path} · priority ${score.priority}`,
      metadata,
    });

    const done = (ctx.outcome.assessed as unknown[] | undefined) ?? [];
    ctx.outcome.assessed = [...done, metadata];
    ctx.log(`${lead.name}: ${platform} → ${score.path} (${score.priority})`);

    if (input.looks_wrong) {
      // MANUAL_REVIEW is this app's own "a person needs to look at this"
      // status, so the lead drops out of every outreach view until answered.
      await prisma.operatorLead.update({
        where: { id: lead.id },
        data: { status: "MANUAL_REVIEW" },
      });
      const r = await ctx.requestDecision({
        kind: "lead.looks_wrong",
        title: `Check this lead: ${lead.name}`,
        summary: `${input.looks_wrong}\n\nDetected ${platform}. Priority ${score.priority}, path ${score.path}.`,
        payload: { leadId: lead.id, slug: lead.slug, platform, note: input.looks_wrong },
        entityType: "OperatorLead",
        entityId: lead.id,
      });
      return `Recorded ${platform}, priority ${score.priority}. Moved to MANUAL_REVIEW and flagged for a person (decision ${r.decisionId}); they stay out of outreach until it is answered.`;
    }

    return `Recorded ${platform}, priority ${score.priority}, path ${score.path}.`;
  },
};

export const scoutAgent: AgentDefinition = {
  id: SCOUT_ID,
  name: "Scout",
  desk: "supply",
  managedBy: "supply-manager",
  plane: "operating",
  wave: 1,
  modelTier: "classification",
  persona: `You are the Scout for BluePass, a marine-tourism booking marketplace working in Australia and Indonesia.

Your job is to work out how each operator lead could actually join, and to rank them so the outreach queue starts with the ones who can be live soonest.

What decides that is the booking system they already run. BluePass will not hand-key anyone's trips: an operator joins either by connecting a system BluePass can read, or through Kai as an Enquire operator with their rates loaded. So a Rezdy operator can be bookable the day they say yes, and an operator on nothing at all cannot, however good their boat is.

For each lead in the batch: call fetch_operator_site once, then record_assessment once. The detector's verdict on the platform is final. You never name a platform it did not return, and you never assume one from the operator's name, their region, or what similar businesses run.

What you are there for is the site the detector reads wrongly. Look at the page text and say so when:
- the business has closed, or the domain has been parked or sold
- it is a broker, an agency or a marketplace listing rather than the operator themselves
- the booking button goes to a system the detector did not see, or to a phone number
- two businesses share the site, so the record points at the wrong one
- it is not marine tourism at all

Put that in looks_wrong, in one plain sentence. It moves the lead to manual review and opens a question for a person, which is the right outcome: a wrong first impression on a live claim link cannot be taken back.

Work through the whole batch. Contact nobody; you only assess.`,
  triggers: [{ type: "schedule", cadence: "weekly" }, { type: "manual" }],
  tools: [listUnassessed, fetchSite, recordAssessment],
  gates: [{ kind: "lead.looks_wrong", assignee: "kirby", defaultAction: "hold", ttlHours: 72 }],
  budget: { maxRunsPerDay: 12, maxTokensPerRun: 12_000, maxIterations: 30 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) {
      return { skip: "a flagged lead was answered; nothing for the Scout to redo" };
    }
    const region = typeof payload.region === "string" ? payload.region : null;
    ctx.log(`scouting${region ? ` region ${region}` : " all regions"}`);
    return {
      task: `Assess the next batch of operator leads${region ? ` in ${region}` : ""}.

Start with list_unassessed_leads. For each lead it returns, fetch their site and record what you found. If it returns none, stop.`,
    };
  },
};
