import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { adminHasCapability } from "@/lib/admin-roles";
import { requireTenantSession, tenantScopeForStudent, tenantScopeForBranch } from "@/lib/tenant-access";

async function isAdmin(userId: string) {
  // Admin AND cleared for this area — see src/lib/admin-roles.ts.
  return adminHasCapability(userId, "reports");
}

export async function GET() {
  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!(await isAdmin(auth.session.user.id))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    // Exams by status
    const statuses = ["registered", "completed", "cancelled"];
    const examsByStatus = {} as Record<string, number>;
    await Promise.all(statuses.map(async (s) => {
      examsByStatus[s] = await prisma.examRegistration.count({ where: { status: s } });
    }));

    const studentWhere = tenantScopeForStudent(auth.tenantId);

    // Attendance summary
    const attendanceStatuses = ["present", "absent", "late", "excused"];
    const attendanceSummary: Record<string, number> = { total: 0 };
    const totalAttendance = await prisma.attendance.count({
      where: {
        student: studentWhere,
      },
    });
    attendanceSummary.total = totalAttendance;
    await Promise.all(attendanceStatuses.map(async (s) => {
      attendanceSummary[s] = await prisma.attendance.count({
        where: {
          status: s,
          student: studentWhere,
        },
      });
    }));

    // Average progress per course
    const courses = await prisma.course.findMany({ select: { id: true, title: true } });
    const avgProgressByCourse = await Promise.all(courses.map(async (c) => {
      const agg = await prisma.progress.aggregate({
        where: {
          courseId: c.id,
          student: studentWhere,
        },
        _avg: { percentComplete: true },
      });
      return { courseId: c.id, title: c.title, avgPercent: agg._avg.percentComplete ?? 0 };
    }));

    // Students by branch
    const branches = await prisma.branch.findMany({
      where: tenantScopeForBranch(auth.tenantId),
      select: { id: true, name: true },
    });
    const studentsByBranch = await Promise.all(branches.map(async (b) => {
      const count = await prisma.student.count({ where: { ...studentWhere, branchId: b.id } });
      return { branchId: b.id, name: b.name, count };
    }));

    return NextResponse.json({ examsByStatus, attendanceSummary, avgProgressByCourse, studentsByBranch });
  } catch (error) {
    console.error("Error building reports:", error);
    return NextResponse.json({ error: "Failed to build reports" }, { status: 500 });
  }
}
