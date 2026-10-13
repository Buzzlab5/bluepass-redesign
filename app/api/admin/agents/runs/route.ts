import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { ensureAgentsLoaded, listAgents, queueSummary } from "@/lib/services/agents";

/**
 * What the agents have been doing: the registered roster, the queue depth,
 * and the recent runs with what each one cost.
 *
 *   GET /api/admin/agents/runs?agent=<id>&limit=50
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const admin = await requireCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorised." }, { status: 403 });

  await ensureAgentsLoaded();
  const params = new URL(request.url).searchParams;
  const agentId = params.get("agent") ?? undefined;
  const limit = Math.min(Number(params.get("limit") ?? 50), 200);

  const [runs, queue] = await Promise.all([
    prisma.agentRun.findMany({
      where: agentId ? { agentId } : undefined,
      orderBy: { startedAt: "desc" },
      take: limit,
    }),
    queueSummary(),
  ]);

  const agents = listAgents().map((a) => ({
    id: a.id,
    name: a.name,
    desk: a.desk,
    wave: a.wave,
    modelTier: a.modelTier,
    triggers: a.triggers,
    tools: a.tools.map((t) => t.name),
    gates: a.gates,
    budget: a.budget,
  }));

  return NextResponse.json({ agents, queue, runs });
}
