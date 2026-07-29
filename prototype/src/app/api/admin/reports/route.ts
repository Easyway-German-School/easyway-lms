import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { adminHasCapability } from "@/lib/admin-roles";

async function isAdmin(userId: string) {
  // Admin AND cleared for this area — see src/lib/admin-roles.ts.
  return adminHasCapability(userId, "reports");
}

export async function GET() {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

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
