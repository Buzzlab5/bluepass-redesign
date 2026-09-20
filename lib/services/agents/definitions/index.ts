/**
 * Every agent BluePass runs, in build order.
 *
 * Wave 1 is the supply funnel, which is where the business is actually
 * stuck: leads exist, pages are built, and almost nothing moves from a list
 * into a bookable operator. These five carry one operator from unknown to
 * onboarded, and the Verifier stands in front of every message any of them
 * writes.
 */

import { hasAgent, registerAgent } from "../runtime/registry";
import type { AgentDefinition } from "../runtime/types";
import { verifierAgent } from "./verifier";
import { scoutAgent } from "./scout";
import { openerAgent } from "./opener";
import { replyDeskAgent } from "./reply-desk";
import { onboarderAgent } from "./onboarder";
import { supplyHealthAgent } from "./supply-health";
import { trustQualityAgent } from "./trust-quality";
import { watchAgent } from "./watch";
import { partnerDeskAgent } from "./partner-desk";
import { operatorSupportAgent } from "./operator-support";

export const ALL_AGENTS: AgentDefinition[] = [
  verifierAgent,
  scoutAgent,
  openerAgent,
  replyDeskAgent,
  onboarderAgent,
  supplyHealthAgent,
  trustQualityAgent,
  watchAgent,
  partnerDeskAgent,
  operatorSupportAgent,
];

export function registerAllAgents(): void {
  for (const def of ALL_AGENTS) {
    if (!hasAgent(def.id)) registerAgent(def);
  }
}

export { verifierAgent, scoutAgent, openerAgent, replyDeskAgent, onboarderAgent, supplyHealthAgent, trustQualityAgent, watchAgent, partnerDeskAgent, operatorSupportAgent };
export { VERIFIER_ID } from "./verifier";
export { SCOUT_ID } from "./scout";
export { OPENER_ID } from "./opener";
export { REPLY_DESK_ID } from "./reply-desk";
export { ONBOARDER_ID } from "./onboarder";
export { SUPPLY_HEALTH_ID } from "./supply-health";
export { TRUST_QUALITY_ID } from "./trust-quality";
export { WATCH_ID } from "./watch";
export { PARTNER_DESK_ID } from "./partner-desk";
export { OPERATOR_SUPPORT_ID } from "./operator-support";
