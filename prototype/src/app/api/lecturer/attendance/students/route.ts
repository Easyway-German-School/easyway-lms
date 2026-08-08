import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dayKey } from "@/lib/class-sessions";
import {
  matchesBatch,
  readAssignment,
  studentWhereForAssignment,
} from "@/lib/lecturer-assignment";

export const dynamic = "force-dynamic";

/**
 * Who a tutor can mark present today.
 *
 * This route used to walk Enrollment rows: Class → Enrollment → Student. Almost
 * no cohort has Enrollment rows — students are grouped by branch + level +
 * sitting, not by enrolment records — so the register came back empty and the
 * "find student" dropdown had nothing in it. That is the bug on the sheet.
 *
 * It now reads the admin-set assignment, the same clause the roster uses, so
 * the register lists exactly the class the tutor was given.
 *
 * `courseId` is still accepted, and still used to narrow the list to one level
 * when a tutor teaches several, but it is no longer what finds the students.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuthSession();
    if (!session || String(session.user?.role ?? "").toLowerCase() !== "lecturer") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const lecturer = await prisma.lecturer.findUnique({
      where: { userId: session.user.id },
    });
    if (!lecturer) {
      return NextResponse.json({ error: "Lecturer profile not found" }, { status: 404 });
    }

    const dateParam = req.nextUrl.searchParams.get("date");
    if (!dateParam) {
      return NextResponse.json({ error: "A date is required" }, { status: 400 });
    }
    const date = dayKey(dateParam);

    const assignment = readAssignment(lecturer);
    const where = studentWhereForAssignment(assignment);
    if (!where) {
      // An empty list rather than an error: the page renders it as "no class
      // assigned yet", which is the truth and is actionable.
      return NextResponse.json([]);
    }

    // Optional narrowing to one level, for a tutor who takes more than one.
    const courseId = req.nextUrl.searchParams.get("courseId");
    let levelFilter: string | null = null;
    if (courseId) {
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { level: true },
      });
      if (course?.level && assignment.levels.includes(course.level)) {
        levelFilter = course.level;
      }
    }

    const students = await prisma.student.findMany({
      where: {
        ...(where as Record<string, unknown>),
        status: "active",
        ...(levelFilter ? { level: levelFilter } : {}),
      } as any,
      select: {
        id: true,
        level: true,
        sessionSlot: true,
        studentCode: true,
        admission: true,
        branch: { select: { name: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const roster = students.filter((student) => matchesBatch(assignment, student.admission));

    // Attendance is keyed on (studentId, date) — one mark per student per day,
    // whichever class recorded it — so today's state is read that way too.
    const marks = await prisma.attendance.findMany({
      where: { studentId: { in: roster.map((student) => student.id) }, date },
      select: { studentId: true, present: true, status: true },
    });
    const marked = new Map(marks.map((mark) => [mark.studentId, mark]));

    return NextResponse.json(
      roster.map((student) => {
        const mark = marked.get(student.id);
        return {
          id: student.id,
          name: student.user.name || student.user.email,
          email: student.user.email,
          studentCode: student.studentCode,
          level: student.level,
          sessionSlot: student.sessionSlot,
          branch: student.branch?.name || "N/A",
          // Default ABSENT, not present. A tutor who forgets to save should not
          // silently produce a register saying everybody attended.
          present: mark?.present ?? false,
          status: mark?.status ?? "absent",
          alreadyMarked: Boolean(mark),
        };
      }),
    );
  } catch (error) {
    console.error("Attendance students GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
