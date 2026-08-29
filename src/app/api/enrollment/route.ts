import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const pathwayId = body.pathwayId as string | undefined;
  const pathwayName = (body.pathwayName as string) || undefined;

  try {
    const student = await prisma.student.findUnique({ where: { userId: session.user.id as string } });
    if (!student) return NextResponse.json({ error: "Student profile not found" }, { status: 404 });

    let pathway;
    if (pathwayId) pathway = await prisma.pathway.findUnique({ where: { id: pathwayId } });
    else if (pathwayName) pathway = await prisma.pathway.findUnique({ where: { name: pathwayName } });

    if (!pathway) return NextResponse.json({ error: "Pathway not found" }, { status: 404 });

    // Upsert enrollment
    const enrollment = await prisma.enrollment.upsert({
      where: { studentId_pathwayId: { studentId: student.id, pathwayId: pathway.id } },
      update: { status: "active" },
      create: { studentId: student.id, pathwayId: pathway.id },
    });

    // Ensure progress rows for each course
    const courses = await prisma.course.findMany({ where: { pathwayId: pathway.id } });
    for (const c of courses) {
      await prisma.progress.upsert({
        where: { studentId_courseId: { studentId: student.id, courseId: c.id } },
        update: {},
        create: { studentId: student.id, courseId: c.id, percentComplete: 0 },
      });
    }

    return NextResponse.json({ success: true, enrollmentId: enrollment.id });
  } catch (error) {
    console.error("Enrollment error:", error);
    return NextResponse.json({ error: "Failed to enroll" }, { status: 500 });
  }
}
