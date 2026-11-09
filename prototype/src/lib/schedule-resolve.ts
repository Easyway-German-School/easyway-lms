import type { Student } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMergedSchedule, type MergedSession } from "@/lib/class-sessions";
import { getPrivateSchedule } from "@/lib/private-classes";
import { nextLevelAfter, sessionDurationMonths } from "@/lib/levels";
import { applyMoves } from "@/lib/schedule-moves";

/**
 * Builds the same timetable payload /api/schedule has always returned for a
 * student's own session, but taking the student as a parameter instead of
 * resolving it from the caller's session — so a parent-facing route can ask
 * for a specific child's timetable through the exact same cohort/private
 * branching, batch anchoring, and attendance merge, without duplicating any
 * of it.
 */
export async function resolveScheduleForStudent(student: Student, requestedLevel?: string | null) {
  const admission =
    typeof student.admission === "object" && student.admission !== null
      ? (student.admission as Record<string, unknown>)
      : {};
  const batch = typeof admission.batch === "string" ? admission.batch : null;

  const nextLevel = nextLevelAfter(student.level);

  if (student.classType === "private") {
    const schedule = await getPrivateSchedule({
      studentId: student.id,
      level: student.level,
      now: new Date(),
      months: 2,
    });

    return {
      ...schedule,
      currentLevel: student.level,
      nextLevel,
      viewingNextLevel: false,
      classType: "private",
      provider: "private-classes",
    };
  }

  const requested = requestedLevel?.toUpperCase();
  const viewingNext = Boolean(requested && nextLevel && requested === nextLevel);
  const level = viewingNext ? (nextLevel as string) : student.level;

  const merged = await getMergedSchedule({
    branchId: student.branchId,
    level,
    batch,
    registeredAt: student.createdAt,
    sessionSlot: student.sessionSlot,
    now: new Date(),
    months: sessionDurationMonths(student.sessionSlot),
  });
  // A moved class shows on the day it now runs, tagged "moved from …" — not as
  // a pink "postponed" box on the day the student no longer needs to come.
  const schedule = { ...merged, months: applyMoves(merged.months) };

  try {
    if (!viewingNext) {
      const planJson = JSON.stringify({ ...schedule, generatedAt: new Date().toISOString() });
      const existing = await prisma.personalizedPlan.findUnique({
        where: { studentId: student.id },
        select: { plan: true },
      });

      const stripTimestamp = (s: string | null) => (s ? s.replace(/"generatedAt":"[^"]*"/, "") : null);

      if (stripTimestamp(existing?.plan ?? null) !== stripTimestamp(planJson)) {
        await prisma.personalizedPlan.upsert({
          where: { studentId: student.id },
          update: { plan: planJson, updatedAt: new Date() as any },
          create: { studentId: student.id, plan: planJson },
        });
      }
    }
  } catch (err) {
    console.warn("Failed to persist personalized plan:", err);
  }

  const attendance = await prisma.attendance.findMany({
    where: { studentId: student.id },
    select: { date: true, present: true, status: true },
  });

  /**
   * Hybrid used to mean "join any sitting of the level, whichever is
   * running" — that vagueness is what let one online tutor's coverage sweep
   * in students who were never meant to be theirs (see lib/hybrid-combo.ts).
   * A hybrid student now has exactly one matched pair of sittings: their own
   * on-campus slot (the calendar above) and, when it differs, their picked
   * online slot. Nothing else is theirs to see or join, so no "also open to
   * you" list is built here any more.
   */
  let alsoJoinable: Array<{ slot: string; sessions: MergedSession[] }> | undefined;
  const onlineSlot = (student.hybridOnlineSlot ?? "").toLowerCase();
  const ownSlot = (student.sessionSlot ?? "").toLowerCase();
  if (!viewingNext && student.deliveryMode === "hybrid" && onlineSlot && onlineSlot !== ownSlot) {
    const merged = await getMergedSchedule({
      branchId: student.branchId,
      level,
      batch,
      registeredAt: student.createdAt,
      sessionSlot: onlineSlot,
      now: new Date(),
      months: sessionDurationMonths(onlineSlot),
    });
    const sessions = applyMoves(merged.months).flatMap((m) => m.sessions);
    if (sessions.length) alsoJoinable = [{ slot: onlineSlot, sessions }];
  }

  return {
    ...schedule,
    currentLevel: student.level,
    nextLevel,
    viewingNextLevel: viewingNext,
    classType: "group",
    provider: "batch-level-engine",
    joinedAt: student.createdAt.toISOString(),
    attendance: attendance.map((record) => ({
      date: record.date.toISOString().slice(0, 10),
      present: record.present || record.status === "present" || record.status === "late",
    })),
    ...(alsoJoinable ? { alsoJoinable } : {}),
  };
}
