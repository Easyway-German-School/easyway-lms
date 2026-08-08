import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { dayKey, normalizeSlot } from "@/lib/class-sessions";
import { COURSE_LEVELS, SESSION_SLOTS } from "@/lib/lecturer-assignment";

/**
 * The office's attendance register: pick a branch, then a class, then a
 * sitting, and see every student in it.
 *
 * The existing admin attendance route returns a flat list of every Attendance
 * row in the school ordered by date. That is a log, not a register — whoever
 * monitors attendance needs to look at one class on one day and see who is
 * missing, which the log cannot answer because it only contains students who
 * were already marked.
 *
 * This starts from the ROSTER instead: everyone registered for that branch,
 * level and sitting, with their mark for the day attached if there is one.
 * A student nobody marked shows as unmarked rather than being absent from the
 * screen entirely.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireCapability("attendance");
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const branchId = params.get("branchId");
  const level = params.get("level");
  const slot = params.get("slot");
  const dateParam = params.get("date");

  const branches = await prisma.branch.findMany({
    where: gate.session.user.tenantId
      ? { tenantId: gate.session.user.tenantId }
      : {},
    orderBy: { name: "asc" },
    select: { id: true, name: true, mode: true },
  });

  // The pickers are always returned, so the page can render its filters before
  // a class has been chosen.
  const options = { branches, levels: COURSE_LEVELS, slots: SESSION_SLOTS };

  if (!branchId || !level) {
    return NextResponse.json({ ...options, chosen: false, students: [], summary: null });
  }

  const date = dayKey(dateParam ?? new Date());
  const sessionSlot = slot ? normalizeSlot(slot) : null;

  const students = await prisma.student.findMany({
    where: {
      branchId,
      level: level.toUpperCase(),
      ...(sessionSlot ? { sessionSlot } : {}),
      status: "active",
      branch: gate.session.user.tenantId
        ? { tenantId: gate.session.user.tenantId }
        : undefined,
    },
    select: {
      id: true,
      studentCode: true,
      level: true,
      sessionSlot: true,
      admission: true,
      user: { select: { name: true, email: true } },
      // Whole-term rate, so the office can see a pattern rather than one day.
      attendances: { select: { present: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Attendance is unique on (studentId, date), so the day's marks come back in
  // one query rather than one per student.
  const marks: Array<{ studentId: string; present?: boolean; status?: string; notes?: string | null }> =
    await prisma.attendance.findMany({
      where: { studentId: { in: students.map((student) => student.id) }, date },
      select: { studentId: true, present: true, status: true, notes: true },
    });

  const marked: Map<string, { studentId: string; present?: boolean; status?: string; notes?: string | null }> =
    new Map(marks.map((mark) => [mark.studentId, mark]));

  // Who was teaching, if the timetable says.
  const classSession = await prisma.classSession.findFirst({
    where: {
      branchId,
      level: level.toUpperCase(),
      date,
      ...(sessionSlot ? { timeSlot: sessionSlot } : {}),
    },
    select: {
      status: true,
      postponedTo: true,
      topic: true,
      startTime: true,
      endTime: true,
      lecturer: { select: { user: { select: { name: true } } } },
    },
  });

  const rows = students.map((student) => {
    const admission =
      typeof student.admission === "object" && student.admission !== null
        ? (student.admission as Record<string, unknown>)
        : {};
    const mark = marked.get(student.id);
    const present = student.attendances.filter((attendance) => attendance.present).length;

    return {
      id: student.id,
      name: student.user.name || student.user.email,
      email: student.user.email,
      studentCode: student.studentCode,
      level: student.level,
      sessionSlot: student.sessionSlot,
      phone: typeof admission.phone === "string" ? admission.phone : null,
      batch: typeof admission.batch === "string" ? admission.batch : null,
      // Three states, not two. "Nobody took the register" is a different
      // problem from "this student did not come", and the office needs to be
      // able to tell which one they are looking at.
      mark: mark ? (mark.present ? "present" : "absent") : "unmarked",
      notes: mark?.notes ?? null,
      termRate: student.attendances.length
        ? Math.round((present / student.attendances.length) * 100)
        : null,
      sessionsRecorded: student.attendances.length,
    };
  });

  return NextResponse.json({
    ...options,
    chosen: true,
    date: date.toISOString(),
    classSession: classSession
      ? {
          status: classSession.status,
          postponedTo: classSession.postponedTo?.toISOString() ?? null,
          topic: classSession.topic,
          startTime: classSession.startTime,
          endTime: classSession.endTime,
          tutorName: classSession.lecturer?.user.name ?? null,
        }
      : null,
    summary: {
      total: rows.length,
      present: rows.filter((row) => row.mark === "present").length,
      absent: rows.filter((row) => row.mark === "absent").length,
      unmarked: rows.filter((row) => row.mark === "unmarked").length,
    },
    students: rows,
  });
}
