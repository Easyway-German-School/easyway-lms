import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";

function escapeCsv(value: unknown) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[,"\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  const gate = await requireCapability("reports");
  if (!gate.ok) return gate.response;

  const statuses = ["registered", "completed", "cancelled"];
  const examsByStatus: Record<string, number> = {};
  await Promise.all(statuses.map(async (status) => {
    examsByStatus[status] = await prisma.examRegistration.count({ where: { status } });
  }));

  const attendanceStatuses = ["present", "absent", "late", "excused"];
  const attendanceSummary: Record<string, number> = { total: 0 };
  attendanceSummary.total = await prisma.attendance.count();
  await Promise.all(attendanceStatuses.map(async (status) => {
    attendanceSummary[status] = await prisma.attendance.count({ where: { status } });
  }));

  const courses = await prisma.course.findMany({ select: { id: true, title: true } });
  const avgProgressByCourse = await Promise.all(courses.map(async (course) => {
    const agg = await prisma.progress.aggregate({ where: { courseId: course.id }, _avg: { percentComplete: true } });
    return { title: course.title, avgPercent: agg._avg.percentComplete ?? 0 };
  }));

  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const studentsByBranch = await Promise.all(branches.map(async (branch) => {
    const count = await prisma.student.count({ where: { branchId: branch.id } });
    return { branch: branch.name, count };
  }));

  const rows: string[] = [];
  rows.push(["Section", "Metric", "Value"].map(escapeCsv).join(","));
  rows.push(["Exams", "Total registrations", Object.values(examsByStatus).reduce((sum, value) => sum + value, 0)].map(escapeCsv).join(","));
  for (const [status, value] of Object.entries(examsByStatus)) {
    rows.push(["Exams", status, value].map(escapeCsv).join(","));
  }
  rows.push(["Attendance", "Total records", attendanceSummary.total].map(escapeCsv).join(","));
  for (const [status, value] of Object.entries(attendanceSummary)) {
    if (status === "total") continue;
    rows.push(["Attendance", status, value].map(escapeCsv).join(","));
  }
  rows.push(["Progress", "Course", "Avg percent"].map(escapeCsv).join(","));
  for (const entry of avgProgressByCourse) {
    rows.push(["Progress", entry.title, Math.round(entry.avgPercent)].map(escapeCsv).join(","));
  }
  rows.push(["Students", "Branch", "Count"].map(escapeCsv).join(","));
  for (const entry of studentsByBranch) {
    rows.push(["Students", entry.branch, entry.count].map(escapeCsv).join(","));
  }

  const csv = rows.join("\r\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=admin-reports.csv",
    },
  });
}
