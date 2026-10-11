import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { getDailyQueue, completeTask, ensureDailyOpsTasks, sendDailyDigestIfNeeded, countDoneToday } from "@/lib/growth/tasks";
import { normalizeGrowthTitle } from "@/lib/growth/titles";
import { readGrowthQuotaSettings } from "@/lib/growth/quota-settings";

export const dynamic = "force-dynamic";

/** GET — the signed-in rep's queue: everything still pending, ranked. */
export async function GET() {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const user = await prisma.user.findUnique({
    where: { id: gate.admin.userId },
    select: { growthTitle: true },
  });
  const title = normalizeGrowthTitle(user?.growthTitle);
  await ensureDailyOpsTasks(gate.admin.userId, title);

  const [tasks, doneToday, quota] = await Promise.all([
    getDailyQueue(gate.admin.userId),
    countDoneToday(gate.admin.userId),
    readGrowthQuotaSettings(gate.session.user.tenantId),
  ]);

  // Awaited, not fire-and-forget: a serverless function can be frozen the
  // instant the response is sent, and an un-awaited promise here would race
  // that and sometimes just never send. sendDailyDigestIfNeeded already
  // swallows its own errors, so this never turns into a failed page load.
  await sendDailyDigestIfNeeded({ userId: gate.admin.userId, title, pendingTaskCount: tasks.length });

  return NextResponse.json({ tasks, doneToday, quota: quota.count });
}

/**
 * PATCH — mark one of today's tasks done or skipped.
 *
 * "Done" on anything tied to a lead is no longer something a rep can just
 * click — it's only ever set by autoCompleteTasksForLeadActivity, triggered
 * by a real note, call, or stage change landing on that lead (see
 * src/lib/growth/tasks.ts). This route still accepts "skipped" for those —
 * an honest "not pursuing this today" is not the claim worth gating. Tasks
 * with no leadId (partner follow-ups, team-report chases) are a person's
 * own admin TODO list, not a sales quota claim, so both outcomes stay
 * available here.
 */
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

  const task = await prisma.salesTask.findUnique({ where: { id: taskId }, select: { assignedToId: true, leadId: true } });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (task.assignedToId !== gate.admin.userId) {
    return NextResponse.json({ error: "That's not on your queue" }, { status: 403 });
  }
  if (task.leadId && outcome === "done") {
    return NextResponse.json(
      { error: "This completes on its own once you log a call, a note, or move the stage — see the lead's Pipeline entry." },
      { status: 400 },
    );
  }

  await completeTask({ taskId, actorId: gate.admin.userId, outcome });
  return NextResponse.json({ ok: true });
}
