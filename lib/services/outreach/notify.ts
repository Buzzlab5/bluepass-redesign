/**
 * Tapping a person: a short email to whoever answers prospects, when a reply needs a human
 * or an agent asks for a decision. It goes to OUTREACH_ALERT_EMAILS, or the admin list if that
 * is unset. A failed alert never fails the work that raised it.
 */

import { sendAuthEmail } from "@/lib/services/auth/email";
import { textToHtml } from "./instantly";

export function alertRecipients(env: Record<string, string | undefined> = process.env) {
  const raw = env.OUTREACH_ALERT_EMAILS?.trim() || env.BLUEPASS_ADMIN_EMAILS?.trim() || "";
  return [...new Set(raw.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
}

export async function notifyTeam(input: { subject: string; text: string }) {
  const to = alertRecipients();
  if (!to.length) {
    console.info("outreach.alert_unrouted", { subject: input.subject });
    return { sent: 0 };
  }
  let sent = 0;
  for (const address of to) {
    try {
      const result = await sendAuthEmail({ to: address, subject: input.subject, text: input.text, html: textToHtml(input.text) });
      if (result.delivered) sent += 1;
    } catch (error) {
      console.error("outreach.alert_failed", { to: address, error: error instanceof Error ? error.message : error });
    }
  }
  return { sent };
}
