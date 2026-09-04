import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { getMergedSchedule } from "@/lib/class-sessions";
import { sessionDurationMonths } from "@/lib/levels";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type PrivateStudentRow = { id: string; classType: string; tutor: { id: string; user: { name: string | null } } | null };
type PrivateClassRow = {
  studentId: string;
  status: string;
  scheduledAt: Date;
  lecturerId: string | null;
  lecturer: { user: { name: string | null } } | null;
  student: { tutor: { id: string; user: { name: string | null } } | null };
};

const PENDING_REQUEST_STATUSES = new Set(["cancel_requested", "reschedule_requested"]);

/**
 * What admin actually needs to know about the private-tutoring desk: is
 * every student paired with someone, is that pairing producing booked
 * sessions, and which tutors are carrying the load — not the tutor's own
 * booking console (message thread, session notes, start-and-ring).
 */
function buildPrivateClassAnalytics(students: PrivateStudentRow[], classes: PrivateClassRow[]) {
  const now = Date.now();
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const in7Days = now + 7 * 24 * 3600 * 1000;

  const privateStudents = students.filter((s) => s.classType === "private");

  type TutorStat = {
    tutorId: string;
    tutorName: string;
    assignedStudents: number;
    upcoming: number;
    next7Days: number;
    completedThisMonth: number;
    cancelledThisMonth: number;
    pending: number;
  };
  const tutorStats = new Map<string, TutorStat>();
  function statFor(tutorId: string, tutorName: string): TutorStat {
    let stat = tutorStats.get(tutorId);
    if (!stat) {
      stat = { tutorId, tutorName, assignedStudents: 0, upcoming: 0, next7Days: 0, completedThisMonth: 0, cancelledThisMonth: 0, pending: 0 };
      tutorStats.set(tutorId, stat);
    }
    return stat;
  }

  for (const student of privateStudents) {
    if (student.tutor) statFor(student.tutor.id, student.tutor.user.name ?? "Unnamed tutor").assignedStudents += 1;
  }

  let unassignedStudents = 0;
  let pendingRequests = 0;
  let upcoming7Days = 0;
  let completedThisMonth = 0;
  let cancelledThisMonth = 0;
  const studentsWithFutureSession = new Set<string>();

  for (const item of classes) {
    const tutorId = item.lecturerId ?? item.student.tutor?.id ?? null;
    const tutorName = item.lecturer?.user?.name ?? item.student.tutor?.user?.name ?? null;
    const scheduledAt = item.scheduledAt.getTime();
    const isFutureBooked = item.status === "scheduled" && scheduledAt >= now;
    const isPending = PENDING_REQUEST_STATUSES.has(item.status);
    const isCancelled = item.status === "cancelled" || item.status === "declined";

    if (isFutureBooked || isPending) studentsWithFutureSession.add(item.studentId);
    if (isFutureBooked) {
      upcoming7Days += scheduledAt <= in7Days ? 1 : 0;
    }
    if (isPending) pendingRequests += 1;
    if (item.status === "completed" && scheduledAt >= startOfMonth) completedThisMonth += 1;
    if (isCancelled && scheduledAt >= startOfMonth) cancelledThisMonth += 1;

    if (tutorId && tutorName) {
      const stat = statFor(tutorId, tutorName);
      if (isFutureBooked) {
        stat.upcoming += 1;
        if (scheduledAt <= in7Days) stat.next7Days += 1;
      }
      if (isPending) stat.pending += 1;
      if (item.status === "completed" && scheduledAt >= startOfMonth) stat.completedThisMonth += 1;
      if (isCancelled && scheduledAt >= startOfMonth) stat.cancelledThisMonth += 1;
    }
  }

  let noUpcomingSession = 0;
  for (const student of privateStudents) {
    if (!student.tutor) { unassignedStudents += 1; continue; }
    if (!studentsWithFutureSession.has(student.id)) noUpcomingSession += 1;
  }

  return {
    totalPrivateStudents: privateStudents.length,
    unassignedStudents,
    noUpcomingSession,
    pendingRequests,
    upcoming7Days,
    completedThisMonth,
    cancelledThisMonth,
    perTutor: [...tutorStats.values()].sort((a, b) => b.assignedStudents - a.assignedStudents),
  };
}

export async function GET() {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId;
  const branchFilter = tenantId ? { tenantId } : {};
  const [students, privateClasses] = await Promise.all([
    prisma.student.findMany({
      where: { status: "active", branch: branchFilter },
      select: {
        id: true, level: true, classType: true, deliveryMode: true, sessionSlot: true,
        createdAt: true, admission: true,
        user: { select: { name: true } },
        branch: { select: { id: true, name: true } },
        tutor: { select: { id: true, user: { select: { name: true } } } },
      },
    }),
    prisma.privateClass.findMany({
      where: { student: { status: "active", branch: branchFilter } },
      include: {
        student: { select: { user: { select: { name: true } }, branch: { select: { name: true } }, deliveryMode: true, tutor: { select: { id: true, user: { select: { name: true } } } } } },
        lecturer: { select: { user: { select: { name: true } } } },
      },
      orderBy: { scheduledAt: "asc" },
    }),
  ]);

  const privateAnalytics = buildPrivateClassAnalytics(students, privateClasses);

  const cohorts = new Map<string, typeof students[number]>();
  for (const student of students) {
    if (student.classType !== "private" && student.branch) {
      const key = `${student.branch.id}:${student.level}:${student.sessionSlot ?? "evening"}`;
      if (!cohorts.has(key)) cohorts.set(key, student);
    }
  }

  const groupSchedules = await Promise.all([...cohorts.values()].map(async (student) => {
    const admission = student.admission && typeof student.admission === "object" && !Array.isArray(student.admission) ? student.admission as Record<string, unknown> : {};
    const schedule = await getMergedSchedule({
      branchId: student.branch!.id,
      level: student.level,
      batch: typeof admission.batch === "string" ? admission.batch : null,
      registeredAt: student.createdAt,
      sessionSlot: student.sessionSlot,
      now: new Date(),
      months: sessionDurationMonths(student.sessionSlot),
    });
    return schedule.months.flatMap((month) => month.sessions.map((session) => ({
      ...session,
      branchName: student.branch!.name,
      deliveryMode: student.deliveryMode,
      tutorName: session.lecturerName,
      cohort: `${student.level} · ${student.branch!.name} · ${session.timeSlot}`,
    })));
  }));

  return NextResponse.json({
    groupSessions: groupSchedules.flat(),
    privateClasses: privateClasses.map((item) => ({
      id: item.id,
      studentId: item.studentId,
      scheduledAt: item.scheduledAt,
      durationMinutes: item.durationMinutes,
      topic: item.topic,
      status: item.status,
      studentName: item.student.user.name ?? "Unknown student",
      branchName: item.student.branch?.name ?? "No branch",
      deliveryMode: item.student.deliveryMode,
      tutorName: item.lecturer?.user?.name ?? item.student.tutor?.user?.name ?? "Tutor not assigned",
    })),
    counts: { students: students.length, cohorts: cohorts.size, privateClasses: privateClasses.length },
    privateAnalytics,
  });
}