import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";

async function requireReportsAdmin() {
  return requireCapability("reports");
}

export async function GET() {
  const gate = await requireReportsAdmin();
  if (!gate.ok) return gate.response;

  try {
    // Exams by status
    const statuses = ["registered", "completed", "cancelled"];
    const examsByStatus = {} as Record<string, number>;
    await Promise.all(statuses.map(async (s) => {
      examsByStatus[s] = await prisma.examRegistration.count({ where: { status: s } });
    }));

    // Attendance summary
    const attendanceStatuses = ["present", "absent", "late", "excused"];
    const attendanceSummary: Record<string, number> = { total: 0 };
    const totalAttendance = await prisma.attendance.count();
    attendanceSummary.total = totalAttendance;
    await Promise.all(attendanceStatuses.map(async (s) => {
      attendanceSummary[s] = await prisma.attendance.count({ where: { status: s } });
    }));

    // Average progress per course
    const courses = await prisma.course.findMany({ select: { id: true, title: true } });
    const avgProgressByCourse = await Promise.all(courses.map(async (c) => {
      const agg = await prisma.progress.aggregate({ where: { courseId: c.id }, _avg: { percentComplete: true } });
      return { courseId: c.id, title: c.title, avgPercent: agg._avg.percentComplete ?? 0 };
    }));

    // Students by branch
    const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
    const studentsByBranch = await Promise.all(branches.map(async (b) => {
      const count = await prisma.student.count({ where: { branchId: b.id } });
      return { branchId: b.id, name: b.name, count };
    }));

    return NextResponse.json({ examsByStatus, attendanceSummary, avgProgressByCourse, studentsByBranch });
  } catch (error) {
    console.error("Error building reports:", error);
    return NextResponse.json({ error: "Failed to build reports" }, { status: 500 });
  }
}
