import { NextResponse } from "next/server";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { issueDirective, listDirectives, revokeDirective } from "@/lib/services/agents";
import type { Levers } from "@/lib/services/agents";

/**
 * Standing direction, for people.
 *
 *   GET  ?scopeId=<agent or manager>&status=ACTIVE|EXPIRED|REVOKED
 *   POST { scopeType, scopeId, instruction, levers, expiresInDays? }
 *   POST { id, revoke: true }
 *
 * A directive narrows what an agent does. It cannot switch off the copy
 * rules, remove or reassign a gate, unlock a manual-only channel, or move
 * money: those are enforced in code that never reads one. An instruction
 * asking for any of that is refused with the reason rather than quietly
 * dropped, because an order you believe was obeyed and was not is worse
 * than one you know was refused.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const admin = await requireCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const raw = params.get("status");
  const status = raw === "EXPIRED" || raw === "REVOKED" ? raw : "ACTIVE";
  return NextResponse.json({
    directives: await listDirectives({ scopeId: params.get("scopeId") ?? undefined, status }),
  });
}

export async function POST(request: Request) {
  const admin = await requireCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  const by = admin.email ?? admin.id ?? "admin";

  const body = (await request.json().catch(() => null)) as
    | {
        id?: string;
        revoke?: boolean;
        scopeType?: "manager" | "agent";
        scopeId?: string;
        instruction?: string;
        levers?: Levers;
        expiresInDays?: number;
      }
    | null;
  if (!body) return NextResponse.json({ error: "Body required." }, { status: 400 });

  if (body.revoke && body.id) {
    await revokeDirective({ id: body.id, by });
    return NextResponse.json({ ok: true, status: "REVOKED" });
  }

  if (!body.scopeType || !body.scopeId || !body.instruction) {
    return NextResponse.json(
      { error: "scopeType, scopeId and instruction are required." },
      { status: 400 },
    );
  }

  const result = await issueDirective({
    scope: { type: body.scopeType, id: body.scopeId },
    instruction: body.instruction,
    levers: body.levers ?? {},
    issuedBy: by,
    expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, refusedBecause: result.refusedBecause }, { status: 422 });
  }
  return NextResponse.json({ ok: true, directiveId: result.directiveId });
}
