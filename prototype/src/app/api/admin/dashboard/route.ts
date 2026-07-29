import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  console.log(`[isAdmin] Checking user ${userId}:`, { role: user?.role, normalized: user?.role?.toLowerCase(), isAdmin: user?.role?.toLowerCase() === "admin" });
  return user?.role?.toLowerCase() === "admin";
}

export async function GET() {
  const session = await getServerSession(authOptions as any) as any;
  console.log(`[admin/dashboard] Session:`, { userId: session?.user?.id, role: session?.user?.role });
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const branches = await prisma.branch.count();
  const students = await prisma.student.count();
  const enrollments = await prisma.enrollment.count();
  const cachedPlans = await prisma.personalizedPlan.count();
  const exams = await prisma.examRegistration.count();
  const attendances = await prisma.attendance.count();
  const materials = await prisma.material.count();
  // Community posts now live in Thread, not the retired Discussion model.
  const discussions = await prisma.thread.count();

  return NextResponse.json({ branches, students, enrollments, cachedPlans, exams, attendances, materials, discussions });
}
