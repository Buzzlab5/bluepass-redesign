/**
 * Event routing. Anything in the app that wants to wake an agent calls
 * `emitDomainEvent`; agents subscribe by action pattern and each match
 * becomes one durable job keyed on the event, so a replayed webhook cannot
 * run an agent twice.
 *
 * Inert unless AGENTS_ENABLED=true, so merging this changes nothing in
 * production until it is switched on deliberately.
 */

import { enqueueJob } from "./jobs";
import { agentsForEvent, ensureAgentsLoaded } from "./registry";

export type DomainEvent = {
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  /** Makes the job key unique per occurrence; use the source row's id. */
  eventId?: string;
};

export function agentsEnabled(): boolean {
  return process.env.AGENTS_ENABLED === "true";
}

export async function emitDomainEvent(
  evt: DomainEvent,
): Promise<{ enqueued: string[] }> {
  if (!agentsEnabled()) return { enqueued: [] };
  await ensureAgentsLoaded();

  const enqueued: string[] = [];
  for (const agent of agentsForEvent(evt.action)) {
    // An agent's own events must never wake that agent.
    if (evt.metadata?.agentId === agent.id) continue;
    const key = `${evt.action}:${evt.entityType}:${evt.entityId}:${evt.eventId ?? "x"}`;
    const { created } = await enqueueJob({
      agentId: agent.id,
      kind: "event",
      triggerKey: key,
      payload: {
        event: evt.action,
        entityType: evt.entityType,
        entityId: evt.entityId,
        metadata: evt.metadata,
      },
    });
    if (created) enqueued.push(agent.id);
  }
  return { enqueued };
}
