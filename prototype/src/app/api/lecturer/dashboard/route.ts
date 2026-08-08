import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  describeAssignment,
  isAssigned,
  matchesBatch,
  readAssignment,
  studentWhereForAssignment,
} from "@/lib/lecturer-assignment";

export const dynamic = "force-dynamic";

/**
 * The first screen a tutor sees.
 *
 * Every number on it was wrong. "Total students" counted Enrollment rows,
 * which almost no cohort has, so a tutor with a full class was greeted with
 * zero. Average attendance filtered on `class.lecturerId`, but the register
 * records against a student and a date, so it read 0% whatever was marked. And
 * the activity feed underneath was three hardcoded lines about a JavaScript
 * course this school does not teach.
 *
 * All of it now comes from the admin-set assignment — the same clause the
 * roster, register and gradebook read — so the dashboard agrees with every
 * other page in the portal.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id || String(session.user.role ?? "").toLowerCase() !== "lecturer") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const lecturer = await prisma.lecturer.findUnique({
      where: { userId: session.user.id },
      include: { _count: { select: { classes: true, materials: true } } },
    });

    if (!lecturer) {
      return NextResponse.json({ error: "Lecturer not found" }, { status: 404 });
    }

    const assignment = readAssignment(lecturer);
    const where = studentWhereForAssignment(assignment);

    const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
    const assignmentLabel = describeAssignment(
      assignment,
      new Map(branches.map((branch) => [branch.id, branch.name])),
    );

    if (!where || !isAssigned(assignment)) {
      return NextResponse.json({
        assigned: false,
        assignmentLabel,
        totalClasses: lecturer._count.classes,
        totalStudents: 0,
        totalMaterials: lecturer._count.materials,
        averageAttendance: null,
        activity: [],
        message: "You have not been assigned a class yet. The school office sets this.",
      });
    }

    const students = await prisma.student.findMany({
      where: where as any,
      select: { id: true, admission: true },
    });
    const studentIds = students
      .filter((student) => matchesBatch(assignment, student.admission))
      .map((student) => student.id);

    // Attendance is keyed on (studentId, date), so a tutor's own class is
    // found through their students — not through a Class row the register
    // never writes.
    const attendance = await prisma.attendance.findMany({
      where: { studentId: { in: studentIds } },
      select: { present: true },
    });
    const averageAttendance = attendance.length
      ? Math.round((attendance.filter((entry) => entry.present).length / attendance.length) * 100)
      : null;

    /**
     * A real activity feed: the last things that actually happened to this
     * tutor's class. Merged from three sources by time, because "what changed
     * since I last looked" is not a question any single table answers.
     */
    const shortDate = (value: Date) =>
      value.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

    const [materials, sessions, grades] = await Promise.all([
      prisma.material.findMany({
        where: { lecturerId: lecturer.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, title: true, kind: true, createdAt: true },
      }),
      prisma.classSession.findMany({
        where: {
          branchId: { in: assignment.branchIds },
          level: { in: assignment.levels },
          status: { in: ["postponed", "cancelled"] },
        },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, date: true, status: true, postponedTo: true, updatedAt: true },
      }),
      prisma.grade.findMany({
        where: { studentId: { in: studentIds } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, type: true, createdAt: true },
      }),
    ]);

    const activity = [
      ...materials.map((item) => ({
        id: `material-${item.id}`,
        kind: item.kind === "recording" ? "recording" : "material",
        title: item.kind === "recording" ? "Recording uploaded" : "Material uploaded",
        detail: item.title,
        at: item.createdAt.toISOString(),
      })),
      ...sessions.map((item) => ({
        id: `session-${item.id}`,
        kind: item.status,
        title: item.status === "postponed" ? "Class postponed" : "Class cancelled",
        detail:
          item.status === "postponed" && item.postponedTo
            ? `${shortDate(item.date)} moved to ${shortDate(item.postponedTo)}`
            : shortDate(item.date),
        at: item.updatedAt.toISOString(),
      })),
      ...grades.map((item) => ({
        id: `grade-${item.id}`,
        kind: "grade",
        title: "Marks entered",
        detail: item.type,
        at: item.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 6);

    return NextResponse.json({
      assigned: true,
      assignmentLabel,
      // What they teach, not how many Class template rows exist.
      totalClasses: assignment.levels.length * Math.max(1, assignment.branchIds.length),
      totalStudents: studentIds.length,
      totalMaterials: lecturer._count.materials,
      averageAttendance,
      activity,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
