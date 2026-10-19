/**
 * The cold-email campaigns Bluepass runs in Instantly, defined here so they can be created
 * the same way every time (scripts/instantly-setup.ts) and found again by name.
 */

import type { OutreachAudience } from "@prisma/client";
import { FOLLOW_UPS } from "./copy";
import { createCampaign, listCampaigns, textToHtml } from "./instantly";

export type CampaignKey = "operators-au" | "creators-au";

export const CAMPAIGNS: Record<CampaignKey, { name: string; audience: OutreachAudience; followUps: keyof typeof FOLLOW_UPS; dailyLimit: number }> = {
  "operators-au": { name: "Bluepass · Operators · Australia", audience: "OPERATOR", followUps: "operators", dailyLimit: 40 },
  "creators-au": { name: "Bluepass · Creators · Australia", audience: "CREATOR", followUps: "creators", dailyLimit: 20 },
};

/**
 * The Instantly campaign body. Step one is each person's own message, carried in their
 * {{subject}} and {{body}} variables; the later steps are shared and reply in the same thread.
 * Tracking pixels and rewritten links are off: they hurt delivery and tell us nothing a reply
 * or a claim does not.
 */
export function campaignBody(key: CampaignKey, sendingAccounts: string[]) {
  const c = CAMPAIGNS[key];
  return {
    name: c.name,
    campaign_schedule: {
      schedules: [{
        name: "Weekdays, business hours",
        timing: { from: "08:30", to: "16:30" },
        days: { "1": true, "2": true, "3": true, "4": true, "5": true },
        timezone: "Australia/Melbourne",
      }],
    },
    sequences: [{
      steps: [
        { type: "email", delay: 0, variants: [{ subject: "{{subject}}", body: "{{body}}" }] },
        ...FOLLOW_UPS[c.followUps].map((f) => ({ type: "email", delay: f.delayDays, variants: [{ subject: "", body: textToHtml(f.body) }] })),
      ],
    }],
    email_list: sendingAccounts,
    daily_limit: c.dailyLimit,
    stop_on_reply: true,
    stop_on_auto_reply: false,
    link_tracking: false,
    open_tracking: false,
    insert_unsubscribe_header: true,
    prioritize_new_leads: true,
    match_lead_esp: true,
    allow_risky_contacts: false,
  };
}

const resolved = new Map<CampaignKey, string>();

/** The Instantly id for a campaign: INSTANTLY_CAMPAIGN_OPERATORS_AU and the like win, else found by name. */
export async function campaignId(key: CampaignKey): Promise<string | null> {
  const fromEnv = process.env[`INSTANTLY_CAMPAIGN_${key.replace(/-/g, "_").toUpperCase()}`];
  if (fromEnv) return fromEnv;
  const cached = resolved.get(key);
  if (cached) return cached;
  const found = (await listCampaigns(CAMPAIGNS[key].name)).find((c) => c.name === CAMPAIGNS[key].name);
  if (found) resolved.set(key, found.id);
  return found?.id ?? null;
}

/** Which of our campaigns an Instantly campaign id belongs to, for webhook events. */
export async function campaignKeyFor(instantlyId: string | null | undefined): Promise<CampaignKey | null> {
  if (!instantlyId) return null;
  for (const key of Object.keys(CAMPAIGNS) as CampaignKey[]) {
    if ((await campaignId(key).catch(() => null)) === instantlyId) return key;
  }
  return null;
}

export async function ensureCampaign(key: CampaignKey, sendingAccounts: string[]) {
  const existing = await campaignId(key);
  if (existing) return { id: existing, created: false };
  const made = await createCampaign(campaignBody(key, sendingAccounts));
  resolved.set(key, made.id);
  return { id: made.id, created: true };
}
