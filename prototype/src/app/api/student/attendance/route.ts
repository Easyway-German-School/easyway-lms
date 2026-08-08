import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      include: {
        attendances: {
          orderBy: { date: "desc" },
          include: {
            class: {
              include: { course: { select: { title: true, level: true } } },
            },
          },
        },
      },
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // Calculate stats
    const stats = {
      total: student.attendances.length,
      present: student.attendances.filter((a) => a.status === "present").length,
      absent: student.attendances.filter((a) => a.status === "absent").length,
      late: student.attendances.filter((a) => a.status === "late").length,
      excused: student.attendances.filter((a) => a.status === "excused").length,
    };

    const records = student.attendances.map((a) => ({
      id: a.id,
      date: a.date.toISOString(),
      status: a.status,
      notes: a.notes,
      className: a.class?.name ?? null,
      // The client renders `course.title`; without it every row read "Course".
      course: a.class?.course ? { title: a.class.course.title, level: a.class.course.level } : null,
    }));

    return NextResponse.json({ records, stats });
  } catch (error) {
    console.error("Error fetching attendance:", error);
    return NextResponse.json(
      { error: "Failed to fetch attendance" },
      { status: 500 }
    );
  }
}
