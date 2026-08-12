import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateStreak, summarizeGamification } from "@/lib/gamification";

export const dynamic = "force-dynamic";

/**
 * The cohort leaderboard — REAL XP, not the three invented students it used to
 * be.
 *
 * `Leaderboard.tsx` shipped with a hardcoded list ("Anna M. — 4520 XP") and a
 * comment promising a real endpoint later. It was never mounted anywhere, which
 * is the only reason no student ever saw fabricated classmates beating them.
 * That is a landmine, not a safeguard: the component was one import away from
 * a page.
 *
 * TWO DELIBERATE SCOPE DECISIONS:
 *
 * 1. **The board is the student's own cohort** — same branch, same level, same
 *    sitting. Not the whole school. A morning A1 student ranked against a
 *    school-wide table is being compared with people sitting a different
 *    syllabus with a different tutor, which is discouraging and meaningless.
 *    It is also the same boundary the community and the classroom now use, so
 *    a student never sees a name they cannot place.
 *
 * 2. **First names and a last initial, never full names or emails.** A
 *    leaderboard is the one screen that publishes one student's performance to
 *    another, and it should give away as little as it can while still being
 *    recognisable to the class.
 */

/** Enough to be motivating, few enough that nobody scrolls a wall of names. */
const TOP_N = 10;

function shortName(name: string | null): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A classmate";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const userId = session.user.id as string;

    const me = await prisma.student.findUnique({
      where: { userId },
      select: { id: true, branchId: true, level: true, sessionSlot: true },
    });
    if (!me) return NextResponse.json({ error: "Student not found" }, { status: 404 });

    const cohort = await prisma.student.findMany({
      where: {
        branchId: me.branchId,
        level: me.level,
        sessionSlot: me.sessionSlot,
        // A withdrawn student should not sit in the table their old classmates
        // are still competing in.
        deletedAt: null,
      },
      select: {
        id: true,
        examReadiness: true,
        user: { select: { id: true, name: true } },
        attendances: { select: { date: true, status: true, present: true } },
        grades: { select: { score: true } },
        completions: { select: { status: true } },
        assignmentSubmissions: { select: { id: true } },
      },
      // A cohort is at most a few dozen; this bound is a guard against a
      // mis-set branch pulling in the whole school, not a real page size.
      take: 200,
    });

    /**
     * XP is computed with the SAME function the student's own dashboard uses.
     *
     * That is the whole reason this is not a hand-rolled query: two different
     * formulas for one number is how a student comes to the office holding a
     * screenshot of their profile saying 3,980 and a leaderboard saying 3,100.
     */
    const rows = cohort.map((student) => {
      const present = student.attendances.filter(
        (record) => record.present || record.status === "present" || record.status === "late",
      );
      const averageGrade =
        student.grades.length > 0
          ? Math.round(student.grades.reduce((sum, g) => sum + g.score, 0) / student.grades.length)
          : null;

      const summary = summarizeGamification({
        completedLessons: student.completions.filter((c) => c.status === "completed").length,
        streak: calculateStreak(present.map((record) => record.date)),
        examReadiness: student.examReadiness ?? 0,
        averageGrade,
        submissions: student.assignmentSubmissions.length,
        sessionsAttended: present.length,
        missionsCompleted: 0,
      });

      return { studentId: student.id, name: shortName(student.user?.name ?? null), xp: summary.xp, me: student.id === me.id };
    });

    rows.sort((a, b) => b.xp - a.xp);
    const ranked = rows.map((row, index) => ({ ...row, rank: index + 1 }));
    const mine = ranked.find((row) => row.me) ?? null;

    /**
     * The student always sees their own row, even from 34th place.
     *
     * A leaderboard that shows a struggling student only the three people
     * beating them is demotivating and tells them nothing they can act on.
     * Appending their own line means the board answers "where am I?" as well as
     * "who is winning?".
     */
    const top = ranked.slice(0, TOP_N);
    const includesMe = mine ? top.some((row) => row.me) : true;

    return NextResponse.json({
      entries: top.map(({ me: _me, studentId: _id, ...row }) => ({ ...row, isMe: _me })),
      you: mine ? { rank: mine.rank, xp: mine.xp, inTop: includesMe } : null,
      cohortSize: ranked.length,
    });
  } catch (error) {
    console.error("Leaderboard failed:", error);
    return NextResponse.json({ error: "Unable to load the leaderboard" }, { status: 500 });
  }
}
