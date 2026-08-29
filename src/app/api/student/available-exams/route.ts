import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

function getExamFee(level: string | null | undefined) {
  if (!level) return 12000;
  if (level.startsWith("A")) return 12000;
  if (level.startsWith("B")) return 14000;
  return 18000;
}

export async function GET() {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const exams = await prisma.exam.findMany({
      where: { examDate: { gte: now } },
      include: {
        course: {
          include: {
            pathway: true,
          },
        },
        registrations: true,
      },
      orderBy: { examDate: "asc" },
    });

    const examList = exams.map((exam) => {
      const registeredCount = exam.registrations?.length ?? 0;
      const capacity = 30;
      const slotsLeft = Math.max(0, capacity - registeredCount);
      return {
        id: exam.id,
        examName: exam.name,
        examDate: exam.examDate.toISOString(),
        level: exam.course?.level ?? "A1",
        branch: exam.course?.pathway?.name ?? "General",
        fee: getExamFee(exam.course?.level),
        slotsLeft,
        deadline: new Date(exam.examDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
    });

    return NextResponse.json({ exams: examList });
  } catch (error) {
    console.error("Error fetching available exams:", error);
    return NextResponse.json(
      { error: "Failed to fetch available exams" },
      { status: 500 }
    );
  }
}
