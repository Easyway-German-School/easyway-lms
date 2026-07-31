import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { letterFor, PASS_MARK } from "@/lib/grading";

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
    const session = (await getServerSession(authOptions as any)) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      select: { id: true, level: true },
    });
    if (!student) {
      return NextResponse.json({ error: "No student record" }, { status: 404 });
    }

    const grades = await prisma.grade.findMany({
      where: { studentId: student.id },
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
      // A centre sitting (ÖSD, Goethe) belongs to no course, so group those
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

    const allScores = grades.map((g) => g.score);
    const overall = allScores.length
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : null;

    return NextResponse.json({
      level: student.level,
      overall,
      overallGrade: overall === null ? null : letterFor(overall),
      passMark: PASS_MARK,
      totalResults: grades.length,
      examsPassed: exams.filter((g) => g.score >= PASS_MARK).length,
      examsTaken: exams.length,
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
