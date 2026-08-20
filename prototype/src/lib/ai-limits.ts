import { prisma } from "@/lib/prisma";
import { currentTenantId } from "@/lib/tenant/context";

export const AI_DAILY_LIMITS = {
  essay: 3,
  pronunciation: 10,
  missionPractice: 10,
} as const;

export const PRIVATE_AI_DAILY_LIMITS = {
  essay: 8,
  pronunciation: 30,
  missionPractice: 30,
} as const;

export type StudentAiKind = keyof typeof AI_DAILY_LIMITS;

export async function reserveStudentAiRequest(
  userId: string,
  kind: StudentAiKind,
): Promise<{ allowed: true; remaining: number } | { allowed: false; remaining: 0 }> {
  const student = await prisma.student.findUnique({
    where: { userId },
    select: { classType: true },
  });
  const limit = student?.classType === "private"
    ? PRIVATE_AI_DAILY_LIMITS[kind]
    : AI_DAILY_LIMITS[kind];
  const tenantId = currentTenantId();
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  await prisma.studentAiUsage.upsert({
    where: { userId_kind_day: { userId, kind, day } },
    create: { userId, tenantId, kind, day, count: 0 },
    update: {},
  });

  // The conditional update is atomic, so simultaneous tabs cannot both pass
  // the final available request.
  const updated = await prisma.studentAiUsage.updateMany({
    where: { userId, kind, day, count: { lt: limit } },
    data: { count: { increment: 1 } },
  });

  if (updated.count !== 1) return { allowed: false, remaining: 0 };
  const row = await prisma.studentAiUsage.findUnique({
    where: { userId_kind_day: { userId, kind, day } },
    select: { count: true },
  });
  return { allowed: true, remaining: Math.max(0, limit - (row?.count ?? limit)) };
}