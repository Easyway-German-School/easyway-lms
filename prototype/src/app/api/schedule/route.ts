import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMergedSchedule } from "@/lib/class-sessions";
import { getPrivateSchedule } from "@/lib/private-classes";
import { nextLevelAfter } from "@/lib/levels";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // A private student sits no group rotation. Sending them the generated
    // timetable would tell them to attend on days they have no class.
    if (student.classType === "private") {
      const schedule = await getPrivateSchedule({
        studentId: student.id,
        level: student.level,
        now: new Date(),
        months: 2,
      });

      return NextResponse.json({
        ...schedule,
        currentLevel: student.level,
        nextLevel,
        viewingNextLevel: false,
        classType: "private",
        provider: "private-classes",
      });
    }

    // Students can preview the timetable for the level they move up to, but
    // only that one — ?level= is not a way to browse the whole school.
    const requested = req.nextUrl.searchParams.get("level")?.toUpperCase();
    const viewingNext = Boolean(requested && nextLevel && requested === nextLevel);
    const level = viewingNext ? (nextLevel as string) : student.level;

    const schedule = await getMergedSchedule({
      branchId: student.branchId,
      level,
      batch,
      // Anchors which occurrence of the batch month is meant — a student who
      // signed up in August for the September batch belongs to the September
      // ahead of them, not the one a year behind.
      registeredAt: student.createdAt,
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

    /**
     * WHAT THE STUDENT ACTUALLY DID, so the calendar stops guessing.
     *
     * The map used to colour a class "done" purely because its date had passed.
     * For a brand-new student that is a lie with a progress bar attached: the
     * batch rotation starts at the batch month, which is routinely before they
     * signed up, so somebody who registered yesterday opened the calendar and
     * found a run of completed classes and "6 / 24 classes" of progress they
     * had never attended.
     *
     * Two facts fix it, and both have to come from the server because only the
     * server knows them:
     *
     *   joinedAt    — anything before this is not their class to have missed.
     *   attendance  — a date-keyed record of what was actually marked.
     *
     * Sent as plain date strings rather than joined into the sessions, because
     * the schedule itself is generated (there is no row per class to hang a
     * status on) and the merge is a client-side lookup by date.
     */
    const attendance = await prisma.attendance.findMany({
      where: { studentId: student.id },
      select: { date: true, present: true, status: true },
    });

    return NextResponse.json({
      ...schedule,
      currentLevel: student.level,
      nextLevel,
      viewingNextLevel: viewingNext,
      classType: "group",
      provider: "batch-level-engine",
      joinedAt: student.createdAt.toISOString(),
      attendance: attendance.map((record) => ({
        date: record.date.toISOString().slice(0, 10),
        present: record.present || record.status === "present" || record.status === "late",
      })),
    });
  } catch (error) {
    console.error("Error generating schedule:", error);
    return NextResponse.json({ error: "Failed to generate schedule" }, { status: 500 });
  }
}
