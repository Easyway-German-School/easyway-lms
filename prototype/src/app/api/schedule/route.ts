import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveScheduleForStudent } from "@/lib/schedule-resolve";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // Students can preview the timetable for the level they move up to, but
    // only that one — ?level= is not a way to browse the whole school.
    const requestedLevel = req.nextUrl.searchParams.get("level");
    const payload = await resolveScheduleForStudent(student, requestedLevel);

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error generating schedule:", error);
    return NextResponse.json({ error: "Failed to generate schedule" }, { status: 500 });
  }
}
