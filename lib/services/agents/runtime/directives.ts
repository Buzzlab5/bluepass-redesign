/**
 * The four levers, and the floor under them.
 *
 * A directive is a standing instruction from a principal, translated from
 * plain language into settings its agents actually obey: where they work,
 * how much they do, whether they are stopped, and a one-off ask.
 *
 * The floor is the point. A directive cannot switch off the copy rules,
 * reassign or remove a gate, unlock a manual-only channel, or widen an
 * agent's tools. Those live in code that never reads a directive, so the
 * guarantee is structural rather than a promise in a prompt. An
 * instruction that would cross the floor is refused out loud, with the
 * reason, rather than quietly dropped: an order you think was obeyed and
 * was not is worse than one you know was refused.
 */

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

/** Everything a directive is permitted to change. There is nothing else. */
export type Levers = {
  /** Narrow an agent to a region or market. */
  region?: string;
  /** Narrow to a segment or category. */
  category?: string;
  /** Stop the agent entirely. Reversible, and always the safe direction. */
  paused?: boolean;
  /**
   * Multiplier on the agent's daily budget, 0 to 1. A manager can slow an
   * agent to nothing; it can never raise the ceiling set in the definition.
   */
  pace?: number;
};

export type DirectiveScope = { type: "manager" | "agent"; id: string };

/**
 * Phrases that are asking for something a directive structurally cannot do.
 * Matching here is a courtesy: even if one slipped through, the rules are
 * enforced elsewhere and would still hold.
 */
const FLOOR_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /\b(?:turn off|disable|skip|bypass|ignore)\b[^.]{0,40}\b(?:copy rule|verif|check)/i, what: "the copy rules" },
  { pattern: /\b(?:approve|decide|sign off)\b[^.]{0,30}\b(?:on my behalf|for me|without me|yourself)/i, what: "a decision that belongs to a person" },
  { pattern: /\b(?:remove|skip|drop|no need for)\b[^.]{0,30}\b(?:gate|approval|review)/i, what: "a gate" },
  { pattern: /\b(?:cold )?(?:dm|message|contact)\b[^.]{0,30}\b(?:on instagram|via instagram|on whatsapp)/i, what: "cold outreach on a manual-only channel" },
  { pattern: /\b(?:send|pay|transfer|refund|payout)\b[^.]{0,30}\b(?:money|funds|the balance)/i, what: "moving money" },
];

export type TranslateResult =
  | { ok: true; levers: Levers }
  | { ok: false; refusedBecause: string };

/**
 * Checks a plain-language instruction against the floor before it is
 * stored. The levers themselves are supplied by the manager, which is the
 * translating party; this refuses the ones that should never have been
 * translated at all.
 */
export function checkInstruction(instruction: string, levers: Levers): TranslateResult {
  for (const { pattern, what } of FLOOR_PATTERNS) {
    if (pattern.test(instruction)) {
      return {
        ok: false,
        refusedBecause: `That asks to change ${what}, which a directive cannot reach. Rules, gates, manual-only channels and anything that moves money are enforced in code that never reads a directive. Nothing has been changed, and the instruction has not been stored.`,
      };
    }
  }
  if (levers.pace !== undefined && (levers.pace < 0 || levers.pace > 1)) {
    return {
      ok: false,
      refusedBecause:
        "Pace is a multiplier between 0 and 1 on the agent's existing daily budget. A manager can slow an agent to nothing but cannot raise the ceiling, which is set in the agent's definition and changed only in code.",
    };
  }
  return { ok: true, levers };
}

export async function issueDirective(params: {
  scope: DirectiveScope;
  instruction: string;
  levers: Levers;
  issuedBy: string;
  expiresAt?: Date | null;
}): Promise<{ ok: true; directiveId: string } | { ok: false; refusedBecause: string }> {
  const checked = checkInstruction(params.instruction, params.levers);
  if (!checked.ok) return { ok: false, refusedBecause: checked.refusedBecause };

  const created = await prisma.agentDirective.create({
    data: {
      scopeType: params.scope.type,
      scopeId: params.scope.id,
      instruction: params.instruction,
      levers: checked.levers as Prisma.InputJsonValue,
      issuedBy: params.issuedBy,
      expiresAt: params.expiresAt ?? null,
    },
    select: { id: true },
  });
  return { ok: true, directiveId: created.id };
}

export async function revokeDirective(params: { id: string; by: string; now?: Date }): Promise<void> {
  await prisma.agentDirective.update({
    where: { id: params.id },
    data: { status: "REVOKED", revokedAt: params.now ?? new Date(), revokedBy: params.by },
  });
}

export async function expireDirectives(now: Date): Promise<number> {
  const r = await prisma.agentDirective.updateMany({
    where: { status: "ACTIVE", expiresAt: { not: null, lte: now } },
    data: { status: "EXPIRED" },
  });
  return r.count;
}

export type ResolvedDirectives = {
  levers: Levers;
  instructions: string[];
};

/**
 * Everything currently in force for one agent: its own directives plus
 * those of the manager that owns it. Pause wins over everything, and the
 * slowest pace wins, so two directives can only ever make an agent do
 * less. That asymmetry is deliberate.
 */
export async function resolveForAgent(params: {
  agentId: string;
  managerId?: string | null;
}): Promise<ResolvedDirectives> {
  const scopes: { scopeType: string; scopeId: string }[] = [
    { scopeType: "agent", scopeId: params.agentId },
  ];
  if (params.managerId) scopes.push({ scopeType: "manager", scopeId: params.managerId });

  const rows = await prisma.agentDirective.findMany({
    where: { status: "ACTIVE", OR: scopes },
    orderBy: { createdAt: "asc" },
    select: { instruction: true, levers: true },
  });

  const levers: Levers = {};
  const instructions: string[] = [];
  for (const row of rows) {
    const l = (row.levers ?? {}) as Levers;
    instructions.push(row.instruction);
    if (l.region) levers.region = l.region;
    if (l.category) levers.category = l.category;
    if (l.paused) levers.paused = true;
    if (l.pace !== undefined) {
      levers.pace = levers.pace === undefined ? l.pace : Math.min(levers.pace, l.pace);
    }
  }
  return { levers, instructions };
}

/** Rendered into the task, so an agent can say what it is working under. */
export function renderDirectives(resolved: ResolvedDirectives): string {
  if (resolved.instructions.length === 0) return "";
  return [
    "",
    "Standing direction you are working under:",
    ...resolved.instructions.map((i) => `- ${i}`),
    resolved.levers.region ? `Scope: ${resolved.levers.region} only.` : "",
    resolved.levers.category ? `Segment: ${resolved.levers.category} only.` : "",
    "These narrow what you work on. They cannot loosen any rule, and if one appears to, the rule wins.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function listDirectives(params: { scopeId?: string; status?: "ACTIVE" | "EXPIRED" | "REVOKED" }) {
  return prisma.agentDirective.findMany({
    where: {
      ...(params.scopeId ? { scopeId: params.scopeId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
