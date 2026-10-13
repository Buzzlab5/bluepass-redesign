/**
 * Prints the WhatsApp templates the booking CMS sends, as the sheet they are created
 * from in Meta's WhatsApp Manager. Regenerate after changing any template:
 *
 *   npx tsx scripts/print-whatsapp-templates.ts > docs/whatsapp-templates.md
 */
import { RAILS_TEMPLATES, renderExample, type RailsTemplate } from "@/lib/services/rails/whatsapp-templates";

const out: string[] = [
  "# WhatsApp templates for the booking CMS",
  "",
  "Generated from `lib/services/rails/whatsapp-templates.ts`; do not edit by hand.",
  "",
  "Create each one in Meta Business Manager, WhatsApp Manager, Message templates:",
  "",
  "- Category: **Utility**. Every message is about a booking the person made.",
  "- Language: **English** (`en`).",
  "- Variable type: **Name** (named variables, as written below).",
  "- Once all six are approved, set `WHATSAPP_RAILS_ENABLED=true`.",
  "",
  "Guest messages are sent from Kai's number (`WHATSAPP_PHONE_ID_KAI`), so a guest who replies reaches Kai. Operator messages are sent from the ops number (`WHATSAPP_PHONE_ID_OPS`).",
  "",
];

for (const t of Object.values(RAILS_TEMPLATES) as RailsTemplate[]) {
  out.push(`## \`${t.name}\``, "");
  out.push(`To: ${t.audience === "traveller" ? "guests who opted in" : "operators"} · From: ${t.sender === "kai" ? "Kai's number" : "the ops number"}`, "");
  out.push("**Body**", "", "```", t.body, "```", "");
  out.push("**Sample values** (Meta asks for one per variable)", "");
  for (const p of t.params) out.push(`- \`${p}\`: ${t.example[p]}`);
  out.push("");
  if (t.button) {
    out.push("**Button**", "");
    out.push(`- Type: Visit website · Text: ${t.button.text}`);
    out.push(`- URL: ${t.button.url.endsWith("{{1}}") ? `Dynamic, \`${t.button.url}\` · Sample: ${t.button.example}` : `Static, ${t.button.url}`}`);
    out.push("");
  }
  out.push("**Reads as**", "", `> ${renderExample(t)}`, "");
}

console.log(out.join("\n"));
