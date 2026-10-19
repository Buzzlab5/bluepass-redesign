/**
 * Instantly (instantly.ai), the cold-email sender: a thin client over its v2 API.
 *
 * Instantly owns the mailboxes, their warm-up and the timing of each sequence step.
 * Bluepass owns who is contacted, what the first message says, and when someone must be
 * taken out (they claimed, joined, replied or said no). Every call here needs
 * INSTANTLY_API_KEY; without it `instantlyConfigured()` is false and nothing is called.
 */

const BASE = "https://api.instantly.ai/api/v2";

export function instantlyConfigured() {
  return Boolean(process.env.INSTANTLY_API_KEY);
}

export class InstantlyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...args) => fetch(...args);

/** Tests swap the network out; nothing else should. */
export function setInstantlyFetch(fn: Fetcher | null) {
  fetcher = fn ?? ((...args) => fetch(...args));
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) throw new InstantlyError("INSTANTLY_API_KEY is not set.", 0);
  const res = await fetcher(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const reason = res.status === 402 ? "the Instantly workspace has no active paid plan" : text.slice(0, 300);
    throw new InstantlyError(`Instantly ${method} ${path} failed (${res.status}): ${reason}`, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export type InstantlyLead = {
  email: string;
  first_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  custom_variables?: Record<string, string | number | boolean | null>;
};

export type AddLeadsResult = {
  leads_uploaded: number;
  duplicated_leads: number;
  in_blocklist: number;
  skipped_count: number;
  invalid_email_count: number;
  created_leads?: { index: number; id: string; email: string }[];
};

/**
 * Adds leads to a campaign. A lead already anywhere in the workspace is skipped, so one
 * person never ends up in two sequences at once.
 */
export function addLeads(campaignId: string, leads: InstantlyLead[]) {
  return call<AddLeadsResult>("POST", "/leads/add", {
    campaign_id: campaignId,
    leads,
    skip_if_in_workspace: true,
  });
}

export function patchLead(leadId: string, data: { custom_variables?: InstantlyLead["custom_variables"]; lt_interest_status?: number }) {
  return call<{ id: string }>("PATCH", `/leads/${leadId}`, data);
}

/** Takes leads out of a campaign so no further step goes to them. */
export function removeLeads(campaignId: string, ids: string[]) {
  return call<{ count: number }>("DELETE", "/leads", { campaign_id: campaignId, ids });
}

export function replyToEmail(input: { replyToId: string; fromAccount: string; subject: string; text: string }) {
  return call<{ id: string }>("POST", "/emails/reply", {
    reply_to_uuid: input.replyToId,
    eaccount: input.fromAccount,
    subject: input.subject,
    body: { text: input.text, html: textToHtml(input.text) },
  });
}

export type InstantlyCampaign = { id: string; name: string; status?: number };

export async function listCampaigns(search?: string) {
  const q = new URLSearchParams({ limit: "100", ...(search ? { search } : {}) });
  const res = await call<{ items: InstantlyCampaign[] }>("GET", `/campaigns?${q}`);
  return res.items ?? [];
}

export function createCampaign(body: Record<string, unknown>) {
  return call<InstantlyCampaign>("POST", "/campaigns", body);
}

export async function listAccounts() {
  const res = await call<{ items: { email: string; status?: number; warmup_status?: number }[] }>("GET", "/accounts?limit=100");
  return res.items ?? [];
}

export async function listWebhooks() {
  const res = await call<{ items: { id: string; target_hook_url: string; event_type: string | null }[] }>("GET", "/webhooks?limit=100");
  return res.items ?? [];
}

export function createWebhook(input: { url: string; secret: string; name: string }) {
  return call<{ id: string }>("POST", "/webhooks", {
    target_hook_url: input.url,
    event_type: "all_events",
    name: input.name,
    headers: { Authorization: `Bearer ${input.secret}` },
  });
}

/** Instantly sends HTML; a plain letter becomes paragraphs and line breaks, nothing more. */
export function textToHtml(text: string) {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => escape(para).replace(/\n/g, "<br/>"))
    .join("<br/><br/>");
}
