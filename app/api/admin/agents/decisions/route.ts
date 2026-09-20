import { NextResponse } from "next/server";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { listDecisions, resolveDecision } from "@/lib/services/agents";

/**
 * The decision queue, for people.
 *   GET  → pending decisions (or ?status=APPROVED|DENIED|EXPIRED)
 *   POST → { id, action } resolves one
 *
 * `requireCurrentAdmin()` runs here in its own right: the /admin layout's
 * gate protects what an admin can see, not an endpoint anyone can POST to.
 */
export const runtime = "nodejs";

const STATUSES = ["PENDING", "APPROVED", "DENIED", "EXPIRED"] as const;
type Status = (typeof STATUSES)[number];

export async function GET(request: Request) {
  const admin = await requireCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorised." }, { status: 403 });

  const raw = new URL(request.url).searchParams.get("status") ?? "PENDING";
  const status = (STATUSES as readonly string[]).includes(raw) ? (raw as Status) : "PENDING";
  return NextResponse.json({ decisions: await listDecisions({ status, limit: 100 }) });
}

export async function POST(request: Request) {
  const admin = await requireCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorised." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { id?: string; action?: string } | null;
  if (!body?.id || !body.action) {
    return NextResponse.json({ error: "id and action are required." }, { status: 400 });
  }
  const decision = await resolveDecision({
    id: body.id,
    action: body.action,
    by: admin.email ?? admin.id ?? "admin",
  });
  return NextResponse.json({ decision });
}
