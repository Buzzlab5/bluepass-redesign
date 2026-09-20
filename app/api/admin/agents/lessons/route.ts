import { NextResponse } from "next/server";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { decideLesson, listLessons, retireLesson } from "@/lib/services/agents";

/**
 * What the agents have proposed to learn, and the decision on each.
 *
 *   GET  ?status=PROPOSED|ACTIVE|REJECTED|RETIRED&agent=<id>
 *   POST { id, action: "teach" | "discard" | "retire", reason? }
 *
 * A proposed lesson does nothing until it is taught here. That gate is the
 * safety property of the learning loop: an agent that could write its own
 * instructions unreviewed would eventually write away the ones that
 * constrain it, and each step of that would read as reasonable.
 */
export const runtime = "nodejs";

const STATUSES = ["PROPOSED", "ACTIVE", "REJECTED", "RETIRED"] as const;
type Status = (typeof STATUSES)[number];

export async function GET(request: Request) {
  const admin = await requireCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorised." }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const raw = params.get("status") ?? "PROPOSED";
  const status = (STATUSES as readonly string[]).includes(raw) ? (raw as Status) : "PROPOSED";
  const lessons = await listLessons({
    status,
    agentId: params.get("agent") ?? undefined,
    limit: 100,
  });
  return NextResponse.json({ lessons });
}

export async function POST(request: Request) {
  const admin = await requireCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorised." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { id?: string; action?: string; reason?: string }
    | null;
  if (!body?.id || !body.action) {
    return NextResponse.json({ error: "id and action are required." }, { status: 400 });
  }

  const by = admin.email ?? admin.id ?? "admin";
  if (body.action === "retire") {
    await retireLesson({ id: body.id, reason: body.reason ?? "Retired by an admin." });
    return NextResponse.json({ ok: true, status: "RETIRED" });
  }
  if (body.action !== "teach" && body.action !== "discard") {
    return NextResponse.json({ error: "action must be teach, discard or retire." }, { status: 400 });
  }
  await decideLesson({ id: body.id, accept: body.action === "teach", by });
  return NextResponse.json({ ok: true, status: body.action === "teach" ? "ACTIVE" : "REJECTED" });
}
