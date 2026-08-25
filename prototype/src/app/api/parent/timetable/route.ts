import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveScheduleForStudent } from "@/lib/schedule-resolve";
import { getParentForUser, assertParentOwnsStudent } from "@/lib/parent-auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id || session.user.role !== "parent") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const studentId = req.nextUrl.searchParams.get("studentId");
    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    const parent = await getParentForUser(session.user.id);
    if (!parent) {
      return NextResponse.json({ error: "Parent not found" }, { status: 404 });
    }

    const owns = await assertParentOwnsStudent(parent.id, studentId);
    if (!owns) {
      return NextResponse.json({ error: "Not your child" }, { status: 403 });
    }

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // Parents only ever see the child's current level — the "preview next
    // level" query param on /api/schedule is a student self-service feature.
    const payload = await resolveScheduleForStudent(student, null);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error generating parent timetable:", error);
    return NextResponse.json({ error: "Failed to generate timetable" }, { status: 500 });
  }
}
