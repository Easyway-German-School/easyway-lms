import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { letterFor, PASS_MARK, weightedCourseworkAverage } from "@/lib/grading";

/**
 * A student's own scores, grouped so the page can show performance per course
 * as well as a single overall figure.
 *
 * Grades carry an optional examId. Exam-linked grades are the formal results
 * (they know their course and date); everything else — essays, quizzes,
 * speaking and pronunciation practice — is coursework, which has no exam and
 * so no course either. Both matter to a student, so both are returned, kept
 * apart rather than averaged into one misleading number.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      select: { id: true, level: true, branchId: true, sessionSlot: true },
    });
    if (!student) {
      return NextResponse.json({ error: "No student record" }, { status: 404 });
    }

    const grades = await prisma.grade.findMany({
      where: { studentId: student.id, OR: [{ examId: null }, { exam: { resultsReleased: true } }] },
      orderBy: { createdAt: "desc" },
      include: {
        exam: {
          select: {
            id: true,
            name: true,
            examDate: true,
            totalScore: true,
            examBody: true,
            level: true,
            course: { select: { id: true, title: true, level: true } },
          },
        },
      },
    });

    const exams = grades.filter((g) => g.exam);
    const coursework = grades.filter((g) => !g.exam);

    // One row per course, so a student can see where they are strong.
    const byCourse = new Map<string, {
      courseId: string;
      courseTitle: string;
      level: string | null;
      results: Array<{
        id: string;
        examName: string;
        examDate: Date;
        score: number;
        total: number;
        grade: string;
        passed: boolean;
        feedback: string | null;
        submissionMode: string;
      }>;
      average: number;
    }>();

    for (const g of exams) {
      // A centre sitting (ÖSD, telc) belongs to no course, so group those
      // under the awarding body instead of dropping them from the results.
      const course = g.exam!.course;
      const groupId = course?.id ?? `body:${g.exam!.examBody ?? "external"}`;
      const groupTitle = course?.title ?? `${g.exam!.examBody ?? "External"} examinations`;

      const entry = byCourse.get(groupId) ?? {
        courseId: groupId,
        courseTitle: groupTitle,
        level: course?.level ?? g.exam!.level ?? null,
        results: [],
        average: 0,
      };
      entry.results.push({
        id: g.id,
        examName: g.exam!.name,
        examDate: g.exam!.examDate,
        score: g.score,
        total: g.exam!.totalScore ?? 100,
        // Derived from the score, never read from Grade.grade: that column is
        // denormalised and drifts whenever a score is corrected without it.
        grade: letterFor(g.score),
        passed: g.score >= PASS_MARK,
        feedback: g.feedback,
        submissionMode: g.submissionMode,
      });
      byCourse.set(groupId, entry);
    }

    for (const entry of byCourse.values()) {
      entry.average = Math.round(
        entry.results.reduce((sum, r) => sum + r.score, 0) / entry.results.length,
      );
    }

    /**
     * One overall number, computed exactly the way the tutor's gradebook
     * computes it: the newest mark in each coursework skill, weighted by type
     * (a quiz counts 0.75, a mock exam 1.75, everything else 1). Exam sittings
     * are reported on their own below and never folded in here — a formal
     * result and a week's classwork are different things, and averaging them
     * gave the student a headline figure that matched nothing on the tutor's
     * screen.
     */
    const latestPerSkill = new Map<string, { type: string; score: number }>();
    for (const g of grades) {
      if (g.exam) continue;
      if (!latestPerSkill.has(g.type)) latestPerSkill.set(g.type, { type: g.type, score: g.score });
    }
    const overall = weightedCourseworkAverage([...latestPerSkill.values()]);

    /**
     * Skills, not a single number.
     *
     * "You average 68" tells a student nothing they can act on. "Your writing
     * is 81 and your listening is 52" tells them what to do on Saturday. The
     * grouping key is `Grade.type`, which is the same vocabulary the tutor's
     * gradebook enters marks under, so the two pages cannot disagree about
     * what a skill is called.
     *
     * Newest first out of the query, so `history` is reversed into reading
     * order and `latest` is simply the first row seen.
     */
    const bySkill = new Map<
      string,
      { type: string; scores: number[]; latest: number; latestAt: Date; feedback: string | null }
    >();
    for (const g of grades) {
      if (g.exam) continue; // formal sittings are reported as exams, below
      const entry = bySkill.get(g.type);
      if (entry) {
        entry.scores.push(g.score);
      } else {
        bySkill.set(g.type, {
          type: g.type,
          scores: [g.score],
          latest: g.score,
          latestAt: g.createdAt,
          feedback: g.feedback,
        });
      }
    }

    const skills = [...bySkill.values()]
      .map((entry) => {
        const average = Math.round(
          entry.scores.reduce((sum, score) => sum + score, 0) / entry.scores.length,
        );
        // First recorded vs most recent, so "improving" means something even
        // when the average has not caught up yet.
        const first = entry.scores[entry.scores.length - 1];
        return {
          type: entry.type,
          average,
          grade: letterFor(average),
          latest: entry.latest,
          latestAt: entry.latestAt,
          attempts: entry.scores.length,
          change: entry.scores.length > 1 ? entry.latest - first : null,
          passed: average >= PASS_MARK,
          feedback: entry.feedback,
        };
      })
      .sort((a, b) => b.average - a.average);

    /** Every score in the order it was earned, for the trend line. */
    const timeline = grades
      .slice()
      .reverse()
      .map((g) => ({
        at: g.createdAt,
        score: g.score,
        label: g.exam?.name ?? g.type,
        isExam: Boolean(g.exam),
      }));

    /**
     * Where they stand in their own class — as a band, never as a rank.
     *
     * A number ("7th of 24") is a public humiliation for whoever is 24th and
     * the school would be handing it to them unprompted. A band tells the
     * student at the top that they are at the top and tells the student at the
     * bottom that there is ground to make up, without either of them learning
     * anything about a named classmate.
     *
     * Compared against the same branch, level and sitting: a Lagos A1 morning
     * student measured against the whole school is not measured against
     * anything they would recognise as their class.
     */
    let standing: { band: string; classSize: number; classAverage: number } | null = null;
    if (overall !== null && student.branchId) {
      const classmates = await prisma.student.findMany({
        where: {
          branchId: student.branchId,
          level: student.level,
          sessionSlot: student.sessionSlot,
          status: "active",
        },
        select: {
          id: true,
          grades: {
            where: { examId: null },
            orderBy: { createdAt: "desc" },
            select: { score: true, type: true },
          },
        },
      });

      // Each classmate measured the same way this student is — newest mark per
      // skill, weighted — so the band compares like with like.
      const averages = classmates
        .map((mate) => {
          const latest = new Map<string, { type: string; score: number }>();
          for (const grade of mate.grades) {
            if (!latest.has(grade.type)) latest.set(grade.type, { type: grade.type, score: grade.score });
          }
          return { id: mate.id, average: weightedCourseworkAverage([...latest.values()]) };
        })
        .filter((mate): mate is { id: string; average: number } => mate.average !== null);

      // Below four graded classmates a "band" is a rank wearing a disguise:
      // "top 25%" in a class of three names one person.
      if (averages.length >= 4) {
        const below = averages.filter((mate) => mate.average < overall).length;
        const percentile = (below / averages.length) * 100;
        standing = {
          band:
            percentile >= 75
              ? "top quarter"
              : percentile >= 50
                ? "upper half"
                : percentile >= 25
                  ? "lower half"
                  : "bottom quarter",
          classSize: averages.length,
          classAverage: Math.round(
            averages.reduce((sum, mate) => sum + mate.average, 0) / averages.length,
          ),
        };
      }
    }

    const attendanceRows = await prisma.attendance.findMany({
      where: { studentId: student.id },
      select: { present: true },
    });
    const attendance = attendanceRows.length
      ? {
          held: attendanceRows.length,
          present: attendanceRows.filter((row) => row.present).length,
          percent: Math.round(
            (attendanceRows.filter((row) => row.present).length / attendanceRows.length) * 100,
          ),
        }
      : null;

    return NextResponse.json({
      level: student.level,
      overall,
      overallGrade: overall === null ? null : letterFor(overall),
      passMark: PASS_MARK,
      totalResults: grades.length,
      examsPassed: exams.filter((g) => g.score >= PASS_MARK).length,
      examsTaken: exams.length,
      skills,
      // Named separately so the page does not have to re-sort to find them,
      // and null rather than the same entry twice when there is only one skill.
      strongest: skills.length > 1 ? skills[0] : null,
      weakest: skills.length > 1 ? skills[skills.length - 1] : null,
      timeline,
      standing,
      attendance,
      courses: [...byCourse.values()].sort((a, b) => a.courseTitle.localeCompare(b.courseTitle)),
      coursework: coursework.map((g) => ({
        id: g.id,
        type: g.type,
        score: g.score,
        grade: letterFor(g.score),
        feedback: g.feedback,
        submissionMode: g.submissionMode,
        createdAt: g.createdAt,
      })),
    });
  } catch (error) {
    console.error("Student results error:", error);
    return NextResponse.json({ error: "Unable to load results" }, { status: 500 });
  }
}
