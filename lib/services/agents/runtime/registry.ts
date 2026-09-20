/**
 * Agent registry. Definitions register themselves once; the runtime looks
 * agents up by id, by the events they subscribe to, and by cadence.
 */

import type { AgentDefinition, Cadence } from "./types";

const agents = new Map<string, AgentDefinition>();

export function registerAgent(def: AgentDefinition): void {
  if (agents.has(def.id)) {
    throw new Error(`Agent "${def.id}" is already registered`);
  }
  const names = new Set<string>();
  for (const t of def.tools) {
    if (names.has(t.name)) {
      throw new Error(`Agent "${def.id}" declares tool "${t.name}" twice`);
    }
    names.add(t.name);
  }
  agents.set(def.id, def);
}

export function hasAgent(id: string): boolean {
  return agents.has(id);
}

export function getAgent(id: string): AgentDefinition {
  const def = agents.get(id);
  if (!def) throw new Error(`Unknown agent "${id}"`);
  return def;
}

export function listAgents(): AgentDefinition[] {
  return [...agents.values()];
}

/** `booking.state_transition.*` matches by prefix; anything else exactly. */
export function matchesPattern(pattern: string, action: string): boolean {
  if (pattern.endsWith("*")) return action.startsWith(pattern.slice(0, -1));
  return pattern === action;
}

export function agentsForEvent(action: string): AgentDefinition[] {
  return listAgents().filter((a) =>
    a.triggers.some(
      (t) => t.type === "event" && matchesPattern(t.pattern, action),
    ),
  );
}

export function agentsForCadence(cadence: Cadence): AgentDefinition[] {
  return listAgents().filter((a) =>
    a.triggers.some((t) => t.type === "schedule" && t.cadence === cadence),
  );
}

/** Tests build small registries; production loads the definitions once. */
export function resetRegistryForTests(): void {
  agents.clear();
  loaded = null;
}

let loaded: Promise<void> | null = null;

/**
 * Loads every definition lazily so the runtime can be imported from the
 * audit hook without pulling the whole tool graph into every request.
 */
export function ensureAgentsLoaded(): Promise<void> {
  if (!loaded) {
    loaded = import("../definitions").then((m) => m.registerAllAgents());
  }
  return loaded;
}
