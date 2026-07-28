import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      include: {
        attendances: {
          orderBy: { date: "desc" },
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
