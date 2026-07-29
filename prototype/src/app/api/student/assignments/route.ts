import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { parseQuestions, toPublicQuestions, gradeQuiz, deadlineFor, isExpired } from "@/lib/assignments";

/**
 * A student's assignments: documents to hand in and timed quizzes.
 *
 * Timing is entirely server-side. Opening a quiz stamps startedAt; the
 * deadline is computed from that, so reloading the page, closing the tab or
 * changing the device clock buys no extra time. A submission that arrives
 * after the deadline is still graded, but only on the answers it carries —
 * there is no way to keep answering past the limit.
 */

export const dynamic = "force-dynamic";

async function currentStudent(userId: string | undefined) {
  if (!userId) return null;
  return prisma.student.findUnique({
    where: { userId },
    select: { id: true, level: true, branchId: true },
  });
}

/** GET — list assignments for this student's level and branch. */
export async function GET() {
  const session = (await getServerSession(authOptions as any)) as any;
  const student = await currentStudent(session?.user?.id);
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assignments = await prisma.assignment.findMany({
    where: {
      published: true,
      level: student.level,
      // Branch-specific assignments plus school-wide ones.
      OR: [{ branchId: student.branchId }, { branchId: null }],
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    include: {
      submissions: { where: { studentId: student.id } },
      lecturer: { select: { user: { select: { name: true } } } },
    },
  });

  const now = new Date();

  return NextResponse.json({
    assignments: assignments.map((a) => {
      const mine = a.submissions[0] ?? null;
      const questions = parseQuestions(a.questions);
      const deadline = deadlineFor(mine?.startedAt ?? null, a.timeLimitMinutes);

      return {
        id: a.id,
        title: a.title,
        description: a.description,
        type: a.type,
        timeLimitMinutes: a.timeLimitMinutes,
        questionCount: questions.length,
        dueAt: a.dueAt,
        lecturerName: a.lecturer?.user?.name ?? null,
        submission: mine
          ? {
              submittedAt: mine.submittedAt,
              score: mine.score,
              feedback: mine.feedback,
              startedAt: mine.startedAt,
              deadline,
              expired: isExpired(mine.startedAt, a.timeLimitMinutes, now),
            }
          : null,
      };
    }),
  });
}

/**
 * POST — start a quiz, or submit an assignment.
 *   { assignmentId, action: "start" }
 *   { assignmentId, action: "submit", answers?, text?, filePath?, fileName? }
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as any;
  const student = await currentStudent(session?.user?.id);
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { assignmentId, action, answers, text, filePath, fileName } = await req.json();
    if (!assignmentId) {
      return NextResponse.json({ error: "assignmentId is required" }, { status: 400 });
    }

    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment || !assignment.published || assignment.level !== student.level) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }
    if (assignment.branchId && assignment.branchId !== student.branchId) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    const existing = await prisma.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
    });

    if (existing?.submittedAt) {
      return NextResponse.json({ error: "You have already submitted this." }, { status: 409 });
    }

    const now = new Date();

    if (action === "start") {
      const questions = parseQuestions(assignment.questions);

      // Re-opening keeps the original clock rather than restarting it.
      const submission = existing
        ? existing
        : await prisma.assignmentSubmission.create({
            data: { assignmentId, studentId: student.id, startedAt: now },
          });

      return NextResponse.json({
        questions: toPublicQuestions(questions),
        startedAt: submission.startedAt,
        deadline: deadlineFor(submission.startedAt, assignment.timeLimitMinutes),
        expired: isExpired(submission.startedAt, assignment.timeLimitMinutes, now),
      });
    }

    if (action === "submit") {
      let score: number | null = null;
      let feedback: string | null = null;

      if (assignment.type === "quiz") {
        const questions = parseQuestions(assignment.questions);
        const expired = isExpired(existing?.startedAt ?? null, assignment.timeLimitMinutes, now);
        const result = gradeQuiz(questions, answers);
        score = result.score;
        feedback = expired
          ? `Time ran out. Scored on the answers submitted: ${result.correct} of ${result.total} correct.`
          : `${result.correct} of ${result.total} correct.`;
      }

      const saved = await prisma.assignmentSubmission.upsert({
        where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
        create: {
          assignmentId,
          studentId: student.id,
          answers: answers ?? undefined,
          text: typeof text === "string" ? text : undefined,
          filePath: typeof filePath === "string" ? filePath : undefined,
          fileName: typeof fileName === "string" ? fileName : undefined,
          score,
          feedback,
          startedAt: existing?.startedAt ?? now,
          submittedAt: now,
        },
        update: {
          answers: answers ?? undefined,
          text: typeof text === "string" ? text : undefined,
          filePath: typeof filePath === "string" ? filePath : undefined,
          fileName: typeof fileName === "string" ? fileName : undefined,
          score,
          feedback,
          submittedAt: now,
        },
      });

      // Auto-graded quizzes become a Grade so they appear alongside exam
      // results on the student's results page.
      if (assignment.type === "quiz" && score !== null) {
        try {
          await prisma.grade.create({
            data: {
              studentId: student.id,
              type: "quiz",
              score,
              feedback,
            },
          });
        } catch (err) {
          console.warn("Could not record quiz grade:", err);
        }
      }

      return NextResponse.json({
        submittedAt: saved.submittedAt,
        score: saved.score,
        feedback: saved.feedback,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Student assignment POST failed:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
