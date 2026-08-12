import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  parseQuestions,
  toPublicQuestions,
  gradeSubmission,
  totalPoints,
  deadlineFor,
  isExpired,
} from "@/lib/assignments";

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
    select: { id: true, level: true, branchId: true, sessionSlot: true },
  });
}

/**
 * Which assignments this student may see.
 *
 * Two conditions live in an explicit AND rather than as sibling keys, because
 * a second top-level `OR` would overwrite the first and quietly widen the
 * query to every branch in the school.
 *
 * The targeting rule: an assignment with NO targets goes to the whole level,
 * which is how every assignment behaved before targeting existed. One or more
 * targets narrows it to exactly those students.
 *
 * The sitting works the same way as the branch: NULL means every sitting, so
 * nothing set before sessions became a boundary changes who it reaches. It
 * matters because one branch runs the same level three times a day under three
 * different tutors, and homework from the morning lesson appearing on the
 * evening class's dashboard is work they were never given.
 */
function visibleTo(student: {
  id: string;
  level: string;
  branchId: string | null;
  sessionSlot: string | null;
}) {
  return {
    published: true,
    level: student.level,
    AND: [
      // Branch-specific assignments plus school-wide ones.
      { OR: [{ branchId: student.branchId }, { branchId: null }] },
      // This sitting's work plus anything set for the whole level.
      { OR: [{ sessionSlot: student.sessionSlot }, { sessionSlot: null }] },
      // Untargeted (everyone) or targeted at me.
      { OR: [{ targets: { none: {} } }, { targets: { some: { studentId: student.id } } }] },
    ],
  };
}

/** GET — list assignments for this student's level and branch. */
export async function GET() {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const student = await currentStudent(session?.user?.id);
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assignments = await prisma.assignment.findMany({
    where: visibleTo(student),
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
        totalPoints: totalPoints(questions),
        dueAt: a.dueAt,
        lecturerName: a.lecturer?.user?.name ?? null,
        submission: mine
          ? {
              submittedAt: mine.submittedAt,
              score: mine.score,
              feedback: mine.feedback,
              // So the portal can say "waiting to be marked" rather than
              // showing a blank where a result should be.
              needsReview: mine.needsReview,
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
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const student = await currentStudent(session?.user?.id);
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { assignmentId, action, answers, text, filePath, fileName } = await req.json();
    if (!assignmentId) {
      return NextResponse.json({ error: "assignmentId is required" }, { status: 400 });
    }

    /**
     * Re-checked here against exactly the same rule the listing uses, rather
     * than trusted because the id arrived. Otherwise a student could submit to
     * any assignment in the school by posting an id they were never shown —
     * including one targeted at somebody else.
     */
    const assignment = await prisma.assignment.findFirst({
      where: { id: String(assignmentId), ...visibleTo(student) },
    });
    if (!assignment) {
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
      let questionScores: object[] | undefined;
      let needsReview = false;

      if (assignment.type === "quiz") {
        const questions = parseQuestions(assignment.questions);
        const expired = isExpired(existing?.startedAt ?? null, assignment.timeLimitMinutes, now);
        const result = gradeSubmission(questions, answers);

        questionScores = result.results as unknown as object[];
        needsReview = result.needsReview;

        /**
         * A paper with written answers gets NO score until a tutor has marked
         * it. Publishing the auto-marked fraction as if it were the result
         * would show a student who wrote a strong essay a low percentage,
         * which reads as a fail rather than as "half marked".
         */
        score = needsReview ? null : result.score;

        const ranOut = expired ? "Time ran out — marked on the answers submitted. " : "";
        feedback = needsReview
          ? `${ranOut}${result.earned} of ${result.possible - result.results.filter((r) => r.needsReview).reduce((sum, r) => sum + r.possible, 0)} on the questions marked automatically. Your written ${result.awaitingReview === 1 ? "answer is" : "answers are"} with your tutor.`
          : `${ranOut}${result.earned} of ${result.possible} marks.`;
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
          questionScores,
          needsReview,
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
          questionScores,
          needsReview,
          submittedAt: now,
        },
      });

      // Auto-graded quizzes become a Grade so they appear alongside exam
      // results on the student's results page. A paper still waiting on a
      // human is deliberately not recorded yet — the marking route writes it
      // once the score is final, so a provisional mark never reaches the
      // transcript or a certificate.
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
