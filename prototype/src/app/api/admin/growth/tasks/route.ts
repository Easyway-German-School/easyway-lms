import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { getDailyQueue, completeTask, ensureDailyOpsTasks } from "@/lib/growth/tasks";
import { normalizeGrowthTitle } from "@/lib/growth/titles";

export const dynamic = "force-dynamic";

/** GET — the signed-in rep's queue: everything still pending, ranked. */
export async function GET() {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const user = await prisma.user.findUnique({
    where: { id: gate.admin.userId },
    select: { growthTitle: true },
  });
  await ensureDailyOpsTasks(gate.admin.userId, normalizeGrowthTitle(user?.growthTitle));

  const tasks = await getDailyQueue(gate.admin.userId);
  return NextResponse.json({ tasks });
}

/** PATCH — mark one of today's tasks done or skipped. */
export async function PATCH(req: NextRequest) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const { taskId, outcome } = (body || {}) as Record<string, unknown>;

  if (typeof taskId !== "string" || !taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }
  if (outcome !== "done" && outcome !== "skipped") {
    return NextResponse.json({ error: 'outcome must be "done" or "skipped"' }, { status: 400 });
  }

  await completeTask({ taskId, actorId: gate.admin.userId, outcome });
  return NextResponse.json({ ok: true });
}
