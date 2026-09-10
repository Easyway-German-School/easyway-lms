import type { Student } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMergedSchedule, normalizeSlot, type MergedSession } from "@/lib/class-sessions";
import { getPrivateSchedule } from "@/lib/private-classes";
import { nextLevelAfter, sessionDurationMonths } from "@/lib/levels";
import { buildCohortTeachers, tutorNameForStudentCohort } from "@/lib/cohort-tutors";

/**
 * The tutor to show a student against every class on their timetable.
 *
 * A directly-named tutor (`Student.tutorId`, or a co-tutor) is the most
 * specific answer and wins. Otherwise it is the cohort's assigned tutor, picked
 * for how this student attends — an online student sees the online tutor, a
 * campus student the in-person one. Only the classes a tutor has actually
 * edited carry a `lecturerName` from the schedule engine itself; this fills the
 * rest, per level+sitting so a hybrid student's "also joinable" sittings each
 * name their own tutor.
 */
async function resolveTimetableTutors(
  student: Pick<Student, "id" | "branchId" | "deliveryMode">,
): Promise<{ nameFor: (level: string, slot: string) => string | null }> {
  const [named, lecturers] = await Promise.all([
    prisma.student.findUnique({
      where: { id: student.id },
      select: {
        tutor: { select: { user: { select: { name: true } } } },
        coTutors: { select: { lecturer: { select: { user: { select: { name: true } } } } } },
      },
    }),
    prisma.lecturer.findMany({
      where: { status: { not: "inactive" } },
      select: {
        id: true,
        status: true,
        user: { select: { name: true } },
        branchId: true,
        level: true,
        sessionSlot: true,
        branchIds: true,
        levels: true,
        sessionSlots: true,
        assignmentGroups: true,
        classTypes: true,
        batches: true,
      },
    }),
  ]);

  const namedTutor =
    named?.tutor?.user?.name ?? named?.coTutors?.[0]?.lecturer?.user?.name ?? null;
  const teachers = buildCohortTeachers(lecturers);

  return {
    nameFor: (level: string, slot: string) => {
      if (namedTutor) return namedTutor;
      if (!student.branchId) return null;
      const key = `${student.branchId}:${level.toUpperCase()}:${normalizeSlot(slot)}`;
      return tutorNameForStudentCohort(teachers, key, student.deliveryMode);
    },
  };
}

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

  const schedule = await getMergedSchedule({
    branchId: student.branchId,
    level,
    batch,
    registeredAt: student.createdAt,
    sessionSlot: student.sessionSlot,
    now: new Date(),
    months: sessionDurationMonths(student.sessionSlot),
  });

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
   * A hybrid or online student attends over video and may join ANY sitting of
   * their level, whichever time it runs (see `liveSessionForStudent`). Their
   * own sitting is the calendar above; the other weekday sittings ride along
   * as a separate list so they can see what else is on and plan to drop in.
   * Not merged into `months` — the node builder counts one class per day.
   */
  let alsoJoinable: Array<{ slot: string; sessions: MergedSession[] }> | undefined;
  const attendsOverVideo = student.deliveryMode === "hybrid" || student.deliveryMode === "online";
  if (!viewingNext && attendsOverVideo) {
    const own = (student.sessionSlot ?? "morning").toLowerCase();
    const otherSlots = (["morning", "afternoon", "evening"] as const).filter((s) => s !== own);
    const built = await Promise.all(
      otherSlots.map((s) =>
        getMergedSchedule({
          branchId: student.branchId,
          level,
          batch,
          registeredAt: student.createdAt,
          sessionSlot: s,
          now: new Date(),
          months: sessionDurationMonths(s),
        }).then((r) => ({ slot: s, sessions: r.months.flatMap((m) => m.sessions) })),
      ),
    );
    const withClasses = built.filter((b) => b.sessions.length > 0);
    if (withClasses.length) alsoJoinable = withClasses;
  }

  /**
   * Put a tutor name on every class. The schedule engine only fills
   * `lecturerName` for days a tutor has actually edited; this backfills the
   * rest from the cohort assignment (or a named pairing) so a student can see
   * who takes their class before the first topic is even set.
   */
  try {
    const { nameFor } = await resolveTimetableTutors(student);
    for (const month of schedule.months) {
      for (const session of month.sessions) {
        if (!session.lecturerName) session.lecturerName = nameFor(level, session.timeSlot);
      }
    }
    for (const group of alsoJoinable ?? []) {
      const name = nameFor(level, group.slot);
      for (const session of group.sessions) {
        if (!session.lecturerName) session.lecturerName = name;
      }
    }
  } catch (err) {
    console.warn("Failed to resolve timetable tutors:", err);
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
