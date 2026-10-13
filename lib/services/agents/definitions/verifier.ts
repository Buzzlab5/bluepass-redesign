/**
 * Agent 01 · Verifier (Wave 1).
 *
 * Nothing goes out of BluePass without clearing this. It runs the
 * deterministic copy rules first, then reads what is left for the things a
 * regex cannot judge: a claim with no source, a number presented as a
 * measurement when it is a model, a credential nobody has verified.
 *
 * It blocks; it never edits. A blocked draft goes back to the agent that
 * wrote it with reasons. The one case it cannot decide, a claim that might
 * be true but is unevidenced, becomes a decision for a person.
 *
 * Other agents do not message this one. They call `verifyOutbound`, which
 * is the same deterministic gate, as a tool in their own run.
 */

import { z } from "zod";
import { checkCopy, formatCopyCheck, type CopyAudience } from "../tools/copy-rules";
import type { AgentDefinition, AgentTool } from "../runtime/types";

export const VERIFIER_ID = "verifier";

/**
 * The gate every drafting agent calls before it sends. Deterministic: same
 * input, same verdict, no model call, no cost.
 */
export const verifyOutbound: AgentTool = {
  name: "verify_outbound",
  description:
    "Check a draft against the BluePass copy rules before it is sent or published. Returns PASS, PASS with warnings, or BLOCKED with the exact phrase at fault. A BLOCKED draft must be rewritten and checked again; never send it as-is and never work around a rule.",
  schema: z.object({
    text: z.string().min(1).max(20000).describe("The exact draft that would be sent."),
    audience: z
      .enum(["customer", "operator", "partner", "internal"])
      .describe("Who receives it. 'internal' relaxes only the percentage rule."),
    kind: z
      .string()
      .max(60)
      .optional()
      .describe("What this is, e.g. 'first-touch email', 'whatsapp reply'."),
  }),
  run: async (input, ctx) => {
    const result = checkCopy(input.text, { audience: input.audience as CopyAudience });
    const prior = (ctx.outcome.verifications as unknown[] | undefined) ?? [];
    ctx.outcome.verifications = [
      ...prior,
      {
        kind: input.kind ?? "draft",
        audience: input.audience,
        pass: result.pass,
        blocking: result.blocking.map((v) => v.rule),
        warnings: result.warnings.map((v) => v.rule),
      },
    ];
    if (!result.pass) {
      ctx.log(`blocked ${input.kind ?? "draft"}: ${result.blocking.map((v) => v.rule).join(", ")}`);
    }
    return formatCopyCheck(result);
  },
};

const recordVerdict: AgentTool = {
  name: "record_verdict",
  description:
    "Record the final verdict for this review. Call exactly once, last. 'blocked' means the draft must not be sent.",
  schema: z.object({
    verdict: z.enum(["pass", "pass_with_notes", "blocked"]),
    reasons: z
      .array(z.string().max(300))
      .max(12)
      .describe("One line per issue, quoting the phrase at fault. Empty when it passes cleanly."),
    rewrite_note: z
      .string()
      .max(600)
      .optional()
      .describe("What the writing agent should change. Never rewrite the copy yourself."),
  }),
  writes: true,
  run: async (input, ctx) => {
    ctx.outcome.verdict = input.verdict;
    ctx.outcome.reasons = input.reasons;
    ctx.outcome.rewriteNote = input.rewrite_note;
    return `Verdict recorded: ${input.verdict}.`;
  },
};

const flagForPerson: AgentTool = {
  name: "flag_for_person",
  description:
    "Use only when a claim might be true but nobody at BluePass has verified it, and the draft cannot ship either way without an answer. Opens a decision for a person. Do not use it for a clear rule violation: block those yourself.",
  schema: z.object({
    claim: z.string().max(500).describe("The exact claim needing verification."),
    why: z.string().max(500).describe("What would have to be true, and who would know."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const r = await ctx.requestDecision({
      kind: "claim.unverified",
      title: "Unverified claim in outbound copy",
      summary: `${input.claim}\n\n${input.why}`,
      payload: { claim: input.claim, why: input.why },
      entityType: (ctx.payload.entityType as string) ?? "Draft",
      entityId: (ctx.payload.entityId as string) ?? ctx.runId,
      onResolve: { agentId: VERIFIER_ID, payload: { step: "recheck" } },
    });
    return `Flagged for a person (decision ${r.decisionId}). The draft is held until it is answered; the default is to hold.`;
  },
};

export const verifierAgent: AgentDefinition = {
  id: VERIFIER_ID,
  name: "Verifier",
  desk: "company",
  plane: "operating",
  wave: 1,
  modelTier: "reasoning",
  persona: `You are the Verifier for BluePass, a marine-tourism booking marketplace in Australia and Indonesia. You are the last check before anything reaches a traveller, an operator, a partner or the public web.

You review a draft. You do not write it and you never rewrite it: you return a verdict and the reasons, and the agent that wrote it fixes it.

Run verify_outbound on the draft first, always. It applies the mechanical rules and its verdict on those is final: you cannot overrule a block, and you never look for a way around one.

Then read what is left for the things a rule cannot catch:
- A claim with no source. BluePass has no case-study numbers, no testimonials and no published results. Any sentence implying one is blocked.
- A number presented as a measurement when it is a model or an estimate. If it is modelled, the copy must say so.
- A credential nobody has verified: certifications, licences, awards, partner names, press mentions.
- Availability, a price, or a date stated as fact. Those come from the operator's live system, never from copy.
- A commitment BluePass has not made: refunds, guarantees, timelines, exclusivity.
- Anything written as if a person sent it personally when an agent wrote it.

If a claim might be true but is unevidenced and the draft cannot ship without it, call flag_for_person. Do not guess, and do not let something through because it sounds reasonable.

Finish with record_verdict, exactly once.`,
  triggers: [{ type: "manual" }],
  tools: [verifyOutbound, recordVerdict, flagForPerson],
  gates: [{ kind: "claim.unverified", assignee: "tony", defaultAction: "hold", ttlHours: 24 }],
  budget: { maxRunsPerDay: 200, maxTokensPerRun: 4000, maxIterations: 6 },
  buildTask: async (payload) => {
    if (payload.decision) {
      const d = payload.decision;
      const held = d.action === "hold" || d.action === "deny";
      return {
        task: `A claim you flagged has been answered.

Claim: ${JSON.stringify((d.payload as Record<string, unknown>)?.claim ?? "(not recorded)")}
Answer: ${d.action}${held ? " (the claim is NOT cleared)" : " (the claim is cleared for use)"}

Record the verdict accordingly: blocked if the claim is not cleared, pass if it is. Do not re-run verify_outbound; the draft text is not in front of you.`,
      };
    }

    const text = typeof payload.text === "string" ? payload.text : null;
    if (!text) return { skip: "no draft text supplied" };
    const audience = (payload.audience as string) ?? "customer";
    const kind = (payload.kind as string) ?? "draft";

    return {
      task: `Review this ${kind} before it goes to a ${audience}.

--- DRAFT START ---
${text}
--- DRAFT END ---

Run verify_outbound on the draft exactly as written, then apply your own judgement, then record_verdict.`,
    };
  },
};
