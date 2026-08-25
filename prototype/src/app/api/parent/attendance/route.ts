import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAttendanceSummary } from "@/lib/parent-attendance";
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
    const month = req.nextUrl.searchParams.get("month");

    const parent = await getParentForUser(session.user.id);
    if (!parent) {
      return NextResponse.json({ error: "Parent not found" }, { status: 404 });
    }

    const owns = await assertParentOwnsStudent(parent.id, studentId);
    if (!owns) {
      return NextResponse.json({ error: "Not your child" }, { status: 403 });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { classType: true, deliveryMode: true },
    });
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const summary = await getAttendanceSummary(studentId, student.classType, student.deliveryMode, month);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Error building parent attendance summary:", error);
    return NextResponse.json({ error: "Failed to fetch attendance" }, { status: 500 });
  }
}
