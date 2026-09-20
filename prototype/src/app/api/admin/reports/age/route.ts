import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import {
  OLDER_LEARNER_MIN_AGE,
  ageFromDob,
  dobOfStudent,
  summariseAges,
  type AgeRow,
} from "@/lib/age-bands";

export const dynamic = "force-dynamic";

/**
 * How old are the people using the LMS, and are the older ones keeping up?
 *
 * Returns bands and counts only — never a birth date. The one per-person list
 * is "older learners worth a phone call": the ones at or above
 * OLDER_LEARNER_MIN_AGE with the weakest attendance and progress, so the office
 * can reach out to the people most likely to be struggling with the portal
 * rather than wait for them to give up.
 *
 * Students only. Tutors, parents and office staff have no birth date on file
 * (no form ever asked), so they cannot be counted honestly.
 */
export async function GET() {
  const gate = await requireCapability("reports");
  if (!gate.ok) return gate.response;

  try {
    const students = await prisma.student.findMany({
      where: { status: "active" },
      select: {
        id: true,
        admission: true,
        level: true,
        profile: { select: { dateOfBirth: true } },
        user: { select: { name: true } },
      },
    });

    const ids = students.map((s) => s.id);

    // Attendance marks per student, folded into a rate. `excused` is left out
    // of the denominator: being excused says nothing about whether the portal
    // works for somebody.
    const marks = ids.length
      ? await prisma.attendance.groupBy({
          by: ["studentId", "status"],
          where: { studentId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const attendance = new Map<string, { attended: number; counted: number }>();
    for (const row of marks) {
      if (row.status === "excused") continue;
      const entry = attendance.get(row.studentId) ?? { attended: 0, counted: 0 };
      entry.counted += row._count._all;
      if (row.status === "present" || row.status === "late") entry.attended += row._count._all;
      attendance.set(row.studentId, entry);
    }

    const progressRows = ids.length
      ? await prisma.progress.groupBy({
          by: ["studentId"],
          where: { studentId: { in: ids } },
          _avg: { percentComplete: true },
        })
      : [];
    const progress = new Map(progressRows.map((r) => [r.studentId, r._avg.percentComplete]));

    const now = new Date();
    const people = students.map((s) => {
      const age = ageFromDob(dobOfStudent(s.profile, s.admission), now);
      const att = attendance.get(s.id);
      const attendanceRate = att && att.counted > 0 ? att.attended / att.counted : null;
      const progressPercent = progress.get(s.id) ?? null;
      return { id: s.id, name: s.user?.name ?? "Student", level: s.level, age, attendanceRate, progressPercent };
    });

    const rows: AgeRow[] = people.map(({ age, attendanceRate, progressPercent }) => ({
      age,
      attendanceRate,
      progressPercent,
    }));

    const checkIn = people
      .filter((p) => p.age !== null && p.age >= OLDER_LEARNER_MIN_AGE)
      .sort(
        (a, b) =>
          (a.attendanceRate ?? -1) - (b.attendanceRate ?? -1) ||
          (a.progressPercent ?? -1) - (b.progressPercent ?? -1),
      )
      .slice(0, 12)
      .map((p) => ({
        id: p.id,
        name: p.name,
        level: p.level,
        age: p.age,
        attendancePercent: p.attendanceRate === null ? null : Math.round(p.attendanceRate * 100),
        progressPercent: p.progressPercent === null ? null : Math.round(p.progressPercent),
      }));

    return NextResponse.json({
      summary: summariseAges(rows),
      olderFrom: OLDER_LEARNER_MIN_AGE,
      checkIn,
    });
  } catch (error) {
    console.error("Error building age report:", error);
    return NextResponse.json({ error: "Could not build the age report" }, { status: 500 });
  }
}
