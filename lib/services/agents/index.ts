/**
 * Public surface of the agent runtime. Routes, jobs and scripts import from
 * here; nothing outside this folder reaches into the runtime modules.
 */

export { drainJobs, runJob, RUNTIME_RULES } from "./runtime/runner";
export type { DrainStats, RunOutcome } from "./runtime/runner";
export { tickSchedules, dueCadences } from "./runtime/schedule";
export { emitDomainEvent, agentsEnabled } from "./runtime/events";
export type { DomainEvent } from "./runtime/events";
export {
  requestDecision,
  resolveDecision,
  expireDecisions,
  listDecisions,
  verifyDecisionSignature,
  decisionLink,
  setDecisionNotifier,
} from "./runtime/decisions";
export type { DecisionNotice } from "./runtime/decisions";
export { enqueueJob, queueSummary, cancelJob } from "./runtime/jobs";
export {
  ensureAgentsLoaded,
  listAgents,
  getAgent,
  hasAgent,
} from "./runtime/registry";
export { getModelPort, setModelPort, ScriptedModel, MODEL_IDS } from "./runtime/model";
export {
  loadLessons,
  listLessons,
  proposeLesson,
  decideLesson,
  retireLesson,
} from "./runtime/lessons";
export type { Lesson, LessonStatus } from "./runtime/lessons";
export { setDispatcher, dispatcherWired } from "./tools/dispatch";
export type { Dispatcher, DispatchRequest, DispatchResult } from "./tools/dispatch";
export { checkCopy, formatCopyCheck } from "./tools/copy-rules";
export { detectPlatform, assessPlatform, scoreProspect, toPmsPlatform } from "./tools/platform-detect";
export type * from "./runtime/types";
