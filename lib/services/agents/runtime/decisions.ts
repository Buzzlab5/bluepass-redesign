/**
 * The decision queue: the short list of actions that wait for a person.
 *
 * Every decision carries a deadline and a safe default (hold the money, do
 * not send, do not suspend). A person answers from the admin page or a
 * one-tap signed link; if nobody answers in time the default is applied and
 * the agent that asked is woken with a follow-up job so it can act on the
 * outcome. Nothing else in the system blocks on a human.
 *
 * Delivery is injected rather than imported, so this module has no opinion
 * about WhatsApp or email and stays testable. The app wires a notifier once
 * at startup; until it does, a decision is still recorded and still expires
 * to its default, it just is not pushed anywhere.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { Prisma, type AgentDecision } from "@prisma/client";
import { enqueueJob } from "./jobs";
import type { DecisionRequest, GatePolicy } from "./types";

const DEFAULT_TTL_HOURS = 24;

export type DecisionNotice = {
  decisionId: string;
  assignee: string;
  title: string;
  summary: string;
  defaultAction: string;
  expiresAt: Date;
  links: { action: string; url: string }[];
};

type Notifier = (notice: DecisionNotice) => Promise<void>;

let notifier: Notifier | null = null;

/** Wire once at startup. A failing notifier never fails a decision. */
export function setDecisionNotifier(fn: Notifier | null): void {
  notifier = fn;
}

function signingSecret(): string | null {
  return process.env.AGENTS_DECISION_SECRET ?? process.env.CRON_SECRET ?? null;
}

export function signDecisionAction(id: string, action: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(`${id}:${action}`).digest("hex");
}

export function verifyDecisionSignature(
  id: string,
  action: string,
  sig: string | null,
): boolean {
  const expected = signDecisionAction(id, action);
  if (!expected || !sig) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function decisionLink(id: string, action: string): string | null {
  const sig = signDecisionAction(id, action);
  if (!sig) return null;
  const base = process.env.BLUEPASS_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return `${base}/api/admin/agents/decisions/${id}?action=${encodeURIComponent(action)}&sig=${sig}`;
}

export async function requestDecision(params: {
  agentId: string;
  runId?: string;
  gate: GatePolicy;
  req: DecisionRequest;
  now?: Date;
}): Promise<{ decisionId: string; existing: boolean }> {
  const now = params.now ?? new Date();

  // One open question per (agent, kind, entity): a retried run must not ask
  // the same person the same thing twice.
  if (params.req.entityType && params.req.entityId) {
    const open = await prisma.agentDecision.findFirst({
      where: {
        agentId: params.agentId,
        kind: params.req.kind,
        entityType: params.req.entityType,
        entityId: params.req.entityId,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (open) return { decisionId: open.id, existing: true };
  }

  const ttl = params.req.ttlHours ?? params.gate.ttlHours ?? DEFAULT_TTL_HOURS;
  const options = params.req.options ?? ["approve", "deny"];
  const created = await prisma.agentDecision.create({
    data: {
      agentId: params.agentId,
      runId: params.runId,
      kind: params.req.kind,
      title: params.req.title,
      summary: params.req.summary,
      payload: (params.req.payload ?? {}) as Prisma.InputJsonValue,
      options: options as Prisma.InputJsonValue,
      defaultAction: params.gate.defaultAction,
      assignee: params.gate.assignee,
      expiresAt: new Date(now.getTime() + ttl * 3_600_000),
      onResolve: (params.req.onResolve ?? Prisma.JsonNull) as
        | Prisma.InputJsonValue
        | typeof Prisma.JsonNull,
      entityType: params.req.entityType,
      entityId: params.req.entityId,
    },
  });

  if (notifier) {
    try {
      await notifier({
        decisionId: created.id,
        assignee: created.assignee,
        title: created.title,
        summary: created.summary,
        defaultAction: created.defaultAction,
        expiresAt: created.expiresAt,
        links: options
          .map((action) => ({ action, url: decisionLink(created.id, action) }))
          .filter((l): l is { action: string; url: string } => Boolean(l.url)),
      });
    } catch (err) {
      console.error("[agents] decision notification failed", err);
    }
  }

  return { decisionId: created.id, existing: false };
}

export async function resolveDecision(params: {
  id: string;
  action: string;
  by: string;
  now?: Date;
}): Promise<AgentDecision> {
  const now = params.now ?? new Date();
  const d = await prisma.agentDecision.findUniqueOrThrow({ where: { id: params.id } });
  if (d.status !== "PENDING") return d;

  const updated = await prisma.agentDecision.update({
    where: { id: d.id },
    data: {
      status: params.action === "deny" ? "DENIED" : "APPROVED",
      decision: params.action,
      decidedBy: params.by,
      decidedAt: now,
    },
  });
  await enqueueFollowUp(updated, params.action, now);
  return updated;
}

/** Applies the safe default to every overdue decision. */
export async function expireDecisions(now: Date): Promise<number> {
  const overdue = await prisma.agentDecision.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    take: 50,
  });
  for (const d of overdue) {
    const updated = await prisma.agentDecision.update({
      where: { id: d.id },
      data: {
        status: "EXPIRED",
        decision: d.defaultAction,
        decidedBy: "default",
        decidedAt: now,
      },
    });
    await enqueueFollowUp(updated, d.defaultAction, now);
  }
  return overdue.length;
}

async function enqueueFollowUp(d: AgentDecision, action: string, now: Date) {
  const onResolve = d.onResolve as
    | { agentId?: string; payload?: Record<string, unknown> }
    | null;
  if (!onResolve?.agentId) return;
  await enqueueJob({
    agentId: onResolve.agentId,
    kind: "decision",
    triggerKey: `decision:${d.id}`,
    runAfter: now,
    payload: {
      ...(onResolve.payload ?? {}),
      entityType: d.entityType ?? undefined,
      entityId: d.entityId ?? undefined,
      decision: { id: d.id, kind: d.kind, action, payload: d.payload },
    },
  });
}

export async function listDecisions(params: {
  status?: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";
  limit?: number;
}): Promise<AgentDecision[]> {
  return prisma.agentDecision.findMany({
    where: params.status ? { status: params.status } : undefined,
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 50,
  });
}
