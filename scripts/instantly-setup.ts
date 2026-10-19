/**
 * Sets up Instantly for Bluepass outreach, once per workspace. Safe to run again: anything
 * that already exists is left alone.
 *
 *   1. Checks the follow-up copy against the copy rules.
 *   2. Lists the connected sending accounts (the warmed mailboxes).
 *   3. Creates the operator and creator campaigns, with those accounts, if they are missing.
 *      They are created paused: start them in Instantly once warm-up has run its course.
 *   4. Registers the webhook to <site>/api/webhooks/instantly with INSTANTLY_WEBHOOK_SECRET.
 *
 *   npx tsx --env-file=.env.local scripts/instantly-setup.ts            (look only)
 *   npx tsx --env-file=.env.local scripts/instantly-setup.ts --apply    (create what is missing)
 */
import { checkCopy } from "@/lib/services/agents/tools/copy-rules";
import { CAMPAIGNS, campaignId, ensureCampaign, type CampaignKey } from "@/lib/services/outreach/campaigns";
import { FOLLOW_UPS } from "@/lib/services/outreach/copy";
import { createWebhook, instantlyConfigured, listAccounts, listWebhooks } from "@/lib/services/outreach/instantly";
import { emailSiteUrl } from "@/lib/services/partner/approval-email";

async function main() {
  const apply = process.argv.includes("--apply");
  if (!instantlyConfigured()) throw new Error("Set INSTANTLY_API_KEY first (an API key from Instantly, Settings, Integrations).");

  for (const [audience, steps] of Object.entries(FOLLOW_UPS)) {
    for (const step of steps) {
      const result = checkCopy(step.body, { audience: audience === "operators" ? "operator" : "partner" });
      if (!result.pass) throw new Error(`The ${audience} follow-up breaks the copy rules: ${result.blocking.map((b) => b.rule).join(", ")}`);
    }
  }
  console.log("Copy rules: follow-ups pass.");

  const accounts = await listAccounts();
  const sending = accounts.map((a) => a.email);
  console.log(`Sending accounts (${sending.length}): ${sending.join(", ") || "none yet"}`);
  if (!sending.length) console.log("  Connect the new mailboxes in Instantly and turn on warm-up before any campaign starts.");

  for (const key of Object.keys(CAMPAIGNS) as CampaignKey[]) {
    const existing = await campaignId(key);
    if (existing) { console.log(`Campaign "${CAMPAIGNS[key].name}": exists (${existing})`); continue; }
    if (!apply) { console.log(`Campaign "${CAMPAIGNS[key].name}": missing, would be created`); continue; }
    const made = await ensureCampaign(key, sending);
    console.log(`Campaign "${CAMPAIGNS[key].name}": created paused (${made.id})`);
  }

  const url = `${emailSiteUrl()}/api/webhooks/instantly`;
  const hooks = await listWebhooks();
  if (hooks.some((h) => h.target_hook_url === url)) {
    console.log(`Webhook: registered (${url})`);
  } else if (!process.env.INSTANTLY_WEBHOOK_SECRET) {
    console.log("Webhook: missing. Set INSTANTLY_WEBHOOK_SECRET (any long random string, the same in the live site's settings) and run again.");
  } else if (!apply) {
    console.log(`Webhook: missing, would register ${url}`);
  } else {
    await createWebhook({ url, secret: process.env.INSTANTLY_WEBHOOK_SECRET, name: "Bluepass outreach" });
    console.log(`Webhook: registered ${url}`);
  }
  if (!apply) console.log("\nNothing was changed. Run with --apply to create what is missing.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
