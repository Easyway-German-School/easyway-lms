import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMergedSchedule } from "@/lib/class-sessions";
import { nextLevelAfter } from "@/lib/levels";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const admission =
      typeof student.admission === "object" && student.admission !== null
        ? (student.admission as Record<string, unknown>)
        : {};
    const batch = typeof admission.batch === "string" ? admission.batch : null;

    const nextLevel = nextLevelAfter(student.level);

    // Students can preview the timetable for the level they move up to, but
    // only that one — ?level= is not a way to browse the whole school.
    const requested = req.nextUrl.searchParams.get("level")?.toUpperCase();
    const viewingNext = Boolean(requested && nextLevel && requested === nextLevel);
    const level = viewingNext ? (nextLevel as string) : student.level;

    const schedule = await getMergedSchedule({
      branchId: student.branchId,
      level,
      batch,
      sessionSlot: student.sessionSlot,
      now: new Date(),
      months: 2,
    });

    // Persist the plan for reuse and auditing, but only when it actually
    // changed. Writing on every calendar view turns a page load into a
    // database write for no benefit.
    try {
      if (!viewingNext) {
        const planJson = JSON.stringify({ ...schedule, generatedAt: new Date().toISOString() });
        const existing = await prisma.personalizedPlan.findUnique({
          where: { studentId: student.id },
          select: { plan: true },
        });

        const stripTimestamp = (s: string | null) =>
          s ? s.replace(/"generatedAt":"[^"]*"/, "") : null;

        if (stripTimestamp(existing?.plan ?? null) !== stripTimestamp(planJson)) {
          await prisma.personalizedPlan.upsert({
            where: { studentId: student.id },
            update: { plan: planJson, updatedAt: new Date() as any },
            create: { studentId: student.id, plan: planJson },
          });
        }
      }
    } catch (err) {
      console.warn("Failed to persist personalized plan:", err);
    }

    return NextResponse.json({
      ...schedule,
      currentLevel: student.level,
      nextLevel,
      viewingNextLevel: viewingNext,
      provider: "batch-level-engine",
    });
  } catch (error) {
    console.error("Error generating schedule:", error);
    return NextResponse.json({ error: "Failed to generate schedule" }, { status: 500 });
  }
}
