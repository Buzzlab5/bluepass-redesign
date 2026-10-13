/**
 * Agent runtime contracts (BluePass Autonomy Map).
 *
 * One runner; every agent is configuration: a persona, a tool allow-list,
 * its triggers, a budget and a gate policy. Agents never mutate booking
 * state or move money directly — their tools call the booking service, the
 * ledger and the other domain services like any other client. Handoffs
 * between agents are rows (jobs, decisions, audit events), never chat.
 */

import type { z } from "zod";

export type AgentPlane = "product" | "operating";
/** Mirrors the Prisma enums, declared locally so the runtime stays portable. */
export type RunStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
export type JobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
export type DecisionStatus = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";
export type Cadence = "hourly" | "daily" | "weekly" | "monthly" | "quarterly";
export type ModelTier = "reasoning" | "classification";
export type Desk =
  | "supply"
  | "travellers"
  | "multipliers"
  | "transactions"
  | "operators"
  | "company";

export type TriggerSpec =
  /** An audit-log action. A trailing `*` matches by prefix. */
  | { type: "event"; pattern: string }
  | { type: "schedule"; cadence: Cadence }
  /** Enqueued by hand (admin API) or by another agent's decision follow-up. */
  | { type: "manual" };

export type DecisionAssignee = "tony" | "kirby" | "inov" | "any";
export type DecisionDefault = "approve" | "deny" | "hold";

/** What happens to a decision nobody answers in time. */
export type GatePolicy = {
  kind: string;
  assignee: DecisionAssignee;
  defaultAction: DecisionDefault;
  ttlHours: number;
};

export type JobPayload = {
  event?: string;
  entityType?: string;
  entityId?: string;
  organizationId?: string;
  actorUserId?: string;
  metadata?: Record<string, unknown>;
  cadence?: Cadence;
  bucket?: string;
  decision?: {
    id: string;
    kind: string;
    action: string;
    payload?: unknown;
  };
  [key: string]: unknown;
};

export type ToolCallRecord = {
  name: string;
  input: unknown;
  result: string;
  ms: number;
  error?: boolean;
};

export type DecisionRequest = {
  kind: string;
  title: string;
  summary: string;
  payload?: Record<string, unknown>;
  options?: string[];
  entityType?: string;
  entityId?: string;
  /** Job to enqueue once a person (or the default) resolves it. */
  onResolve?: { agentId: string; payload?: Record<string, unknown> };
  ttlHours?: number;
};

export interface RunContext {
  agent: AgentDefinition;
  runId: string;
  jobId: string | null;
  triggerKey: string;
  payload: JobPayload;
  now: Date;
  /** Tools write here; persisted on the AgentRun row. */
  outcome: Record<string, unknown>;
  toolCalls: ToolCallRecord[];
  log: (line: string) => void;
  requestDecision: (
    req: DecisionRequest,
  ) => Promise<{ decisionId: string; existing: boolean }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AgentTool<S extends z.ZodTypeAny = any> {
  name: string;
  description: string;
  schema: S;
  /** True when the tool changes state; recorded for audit and review. */
  writes?: boolean;
  run: (input: z.infer<S>, ctx: RunContext) => Promise<string>;
}

export type TaskBuild =
  | { task: string; skip?: undefined }
  | { skip: string; task?: undefined };

export interface AgentDefinition {
  id: string;
  name: string;
  desk: Desk;
  /** The manager whose directives apply to this agent, if any. */
  managedBy?: string;
  plane: AgentPlane;
  wave: 0 | 1 | 2 | 3;
  modelTier: ModelTier;
  /** Stable system prompt. Volatile context goes in the task, never here. */
  persona: string;
  triggers: TriggerSpec[];
  tools: AgentTool[];
  gates: GatePolicy[];
  budget: {
    maxRunsPerDay: number;
    maxTokensPerRun: number;
    maxIterations: number;
  };
  /**
   * Loads the context for this trigger and renders the user turn. Return
   * `{ skip }` when there is nothing to do; the run is recorded as SKIPPED
   * and no model call is made.
   */
  buildTask: (payload: JobPayload, ctx: RunContext) => Promise<TaskBuild>;
}

export type ModelRunParams = {
  model: string;
  system: string;
  user: string;
  tools: AgentTool[];
  ctx: RunContext;
  maxTokens: number;
  maxIterations: number;
  thinking: boolean;
};

export type ModelRunResult = {
  text: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

export interface ModelPort {
  run(params: ModelRunParams): Promise<ModelRunResult>;
}
