import { NextResponse } from "next/server";
import { resolveDecision, verifyDecisionSignature } from "@/lib/services/agents";

/**
 * One-tap resolution from the link in a decision notification.
 *
 *   GET /api/admin/agents/decisions/:id?action=approve&sig=<hmac>
 *
 * The signature is an HMAC over "id:action", so a link approves exactly one
 * action on one decision and nothing else. That is what lets this answer
 * without a session: the whole point is that a decision can be cleared from
 * a phone, in the field, between trips.
 */
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const action = params.get("action");
  const sig = params.get("sig");

  if (!action || !verifyDecisionSignature(id, action, sig)) {
    return new NextResponse(page("This link is not valid.", false), {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const decision = await resolveDecision({ id, action, by: "one-tap" });
  return new NextResponse(
    page(`${decision.title}: recorded as "${decision.decision}".`, true),
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function page(message: string, ok: boolean): string {
  const accent = ok ? "#5fbfb0" : "#de8e80";
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BluePass decision</title><body style="margin:0;font:17px/1.5 -apple-system,Helvetica,Arial,sans-serif;background:#07141d;color:#dee9e7;display:grid;place-items:center;min-height:100vh;padding:24px"><div style="max-width:32rem"><p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${accent};margin:0 0 12px">BluePass · ${ok ? "Decision recorded" : "Not recorded"}</p><p style="margin:0">${escapeHtml(message)}</p></div></body>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
