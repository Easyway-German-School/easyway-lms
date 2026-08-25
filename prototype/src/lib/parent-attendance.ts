import { prisma } from "@/lib/prisma";
import { ensureAttendanceComputed } from "@/lib/private-classes";

/**
 * "X of Y classes attended this month" for one child, for the parent
 * dashboard. There is no single attendance source in this app — see the
 * doc-comments on the Attendance and PrivateClass models — so this branches
 * by how the child actually attends rather than pretending one query covers
 * both.
 *
 * Deliberately does NOT touch ClassSession: it carries no per-student
 * attendance field, so a cohort student's `total` here reflects only the
 * days a lecturer actually took register, not the full generated timetable.
 * Undercounting is expected when a lecturer skips the register — that's a
 * pre-existing gap in cohort attendance-taking, not something this function
 * can see past.
 */

export type AttendanceSummary = {
  present: number;
  total: number;
  basis: "cohort-register" | "private-sessions";
  records: { date: string; status: string }[];
};

function monthRange(month: string | null): { start: Date; end: Date } {
  const now = new Date();
  const [y, m] = month && /^\d{4}-\d{2}$/.test(month) ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  return { start, end };
}

export async function getAttendanceSummary(
  studentId: string,
  classType: string,
  deliveryMode: string,
  month: string | null,
): Promise<AttendanceSummary> {
  const { start, end } = monthRange(month);

  if (classType === "private") {
    const sessions = await prisma.privateClass.findMany({
      where: {
        studentId,
        scheduledAt: { gte: start, lt: end },
        status: { in: ["scheduled", "completed"] },
      },
      select: {
        id: true,
        studentId: true,
        scheduledAt: true,
        durationMinutes: true,
        status: true,
        deliveryMode: true,
        attendanceStatus: true,
      },
      orderBy: { scheduledAt: "asc" },
    });

    // Only sessions that have actually ended count toward the denominator —
    // a class still ahead this month isn't a missed one yet.
    const ended = sessions.filter((s) => s.scheduledAt.getTime() + s.durationMinutes * 60_000 <= Date.now());

    const records = await Promise.all(
      ended.map(async (s) => ({
        date: s.scheduledAt.toISOString().slice(0, 10),
        status: (await ensureAttendanceComputed(s, deliveryMode)) || "unrecorded",
      })),
    );

    return {
      present: records.filter((r) => r.status === "present").length,
      total: records.length,
      basis: "private-sessions",
      records,
    };
  }

  const rows = await prisma.attendance.findMany({
    where: { studentId, date: { gte: start, lt: end } },
    select: { date: true, present: true, status: true },
    orderBy: { date: "asc" },
  });

  const records = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    status: r.present || r.status === "present" || r.status === "late" ? "present" : r.status || "absent",
  }));

  return {
    present: records.filter((r) => r.status === "present").length,
    total: records.length,
    basis: "cohort-register",
    records,
  };
}
