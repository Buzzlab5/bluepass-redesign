/**
 * The learning loop.
 *
 * An agent reads what it has learned before it acts. A lesson is a short,
 * scoped instruction derived from evidence already in the database: what
 * the Verifier kept blocking, which openers got replies, where a person
 * drew the line when they approved or denied a decision.
 *
 * Three properties make this safe rather than a slow drift into whatever
 * the model finds agreeable.
 *
 * Lessons are proposed, never self-applied. The Coach writes them; a
 * person makes them active. An agent that could write its own instructions
 * unreviewed would eventually write away the ones that constrain it, and
 * it would do so for reasons that read perfectly well at each step.
 *
 * Lessons are context, not identity. They go in the task, never in the
 * persona, which keeps the cached prefix stable and keeps the distinction
 * honest: the persona is what an agent IS, a lesson is something it has
 * noticed lately and might later be wrong about.
 *
 * Lessons cannot reach the floor. The copy rules, the gates, the manual-only
 * channels and the tool allow-lists are enforced in code that never consults
 * a lesson, so no lesson can loosen them however it is worded.
 */

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

export type LessonStatus = "PROPOSED" | "ACTIVE" | "REJECTED" | "RETIRED";

export type Lesson = {
  id: string;
  agentId: string;
  scope: string;
  lesson: string;
  timesApplied: number;
};

/** Cap what one agent carries, so the task cannot grow without bound. */
const MAX_ACTIVE_PER_AGENT = 12;

/**
 * The active lessons for an agent, oldest-proven first. Increments the
 * applied count so a lesson nobody ever hits can be retired later.
 */
export async function loadLessons(agentId: string): Promise<Lesson[]> {
  const rows = await prisma.agentLesson.findMany({
    where: { agentId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    take: MAX_ACTIVE_PER_AGENT,
    select: { id: true, agentId: true, scope: true, lesson: true, timesApplied: true },
  });
  if (rows.length > 0) {
    await prisma.agentLesson.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { timesApplied: { increment: 1 } },
    });
  }
  return rows;
}

/** Rendered into the task, never the persona, so the cached prefix holds. */
export function renderLessons(lessons: Lesson[]): string {
  if (lessons.length === 0) return "";
  return [
    "",
    "What you have learned from your own past runs. These are observations from evidence, not rules:",
    ...lessons.map((l) => `- When ${l.scope}: ${l.lesson}`),
    "",
    "They do not override anything in your instructions above, and nothing here can loosen a rule. If a lesson conflicts with a rule, the rule wins and the lesson is wrong.",
  ].join("\n");
}

export async function proposeLesson(params: {
  agentId: string;
  scope: string;
  lesson: string;
  evidence: Record<string, unknown>;
  proposedByRunId: string;
}): Promise<{ lessonId: string; duplicate: boolean }> {
  // A near-identical open proposal for the same agent and scope is the
  // Coach noticing the same thing twice, not a second lesson.
  const existing = await prisma.agentLesson.findFirst({
    where: {
      agentId: params.agentId,
      scope: params.scope,
      status: { in: ["PROPOSED", "ACTIVE"] },
    },
    select: { id: true },
  });
  if (existing) return { lessonId: existing.id, duplicate: true };

  const created = await prisma.agentLesson.create({
    data: {
      agentId: params.agentId,
      scope: params.scope,
      lesson: params.lesson,
      evidence: params.evidence as Prisma.InputJsonValue,
      proposedByRunId: params.proposedByRunId,
    },
    select: { id: true },
  });
  return { lessonId: created.id, duplicate: false };
}

export async function decideLesson(params: {
  id: string;
  accept: boolean;
  by: string;
  now?: Date;
}): Promise<void> {
  await prisma.agentLesson.update({
    where: { id: params.id },
    data: {
      status: params.accept ? "ACTIVE" : "REJECTED",
      decidedBy: params.by,
      decidedAt: params.now ?? new Date(),
    },
  });
}

export async function retireLesson(params: { id: string; reason: string }): Promise<void> {
  await prisma.agentLesson.update({
    where: { id: params.id },
    data: { status: "RETIRED", retiredReason: params.reason },
  });
}

export async function listLessons(params: {
  agentId?: string;
  status?: LessonStatus;
  limit?: number;
}) {
  return prisma.agentLesson.findMany({
    where: {
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 50,
  });
}
