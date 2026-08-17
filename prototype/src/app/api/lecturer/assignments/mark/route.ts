import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { notify, KIND } from "@/lib/notify";
import {
  parseQuestions,
  finaliseScore,
  type QuestionResult,
} from "@/lib/assignments";

/**
 * The marking queue for written answers.
 *
 * GET  — papers waiting on a human, with the student's words and the tutor's
 *        own guidance note beside each question.
 * POST — award the outstanding marks and finalise the paper.
 *
 * A paper sits here with `score` null rather than part-marked, so nothing in
 * the portal, the transcript or a certificate can quote a provisional figure
 * as if it were the result.
 */

export const dynamic = "force-dynamic";

type LecturerStaffAuth = { error: NextResponse } | { userId: string; lecturerId: string | null };

async function requireStaff(): Promise<LecturerStaffAuth> {
  const session = await requireAuthSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, lecturer: { select: { id: true } } },
  });
  const role = String(user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return { error: NextResponse.json({ error: "Staff access required" }, { status: 403 }) };
  }
  return { userId: user!.id, lecturerId: user?.lecturer?.id ?? null };
}

export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  const assignmentId = req.nextUrl.searchParams.get("assignmentId");

  const pending = await prisma.assignmentSubmission.findMany({
    where: {
      needsReview: true,
      submittedAt: { not: null },
      ...(assignmentId ? { assignmentId } : {}),
    },
    orderBy: { submittedAt: "asc" },
    include: {
      student: {
        select: { id: true, studentCode: true, level: true, user: { select: { name: true } } },
      },
      assignment: { select: { id: true, title: true, questions: true, level: true } },
    },
  });

  return NextResponse.json({
    submissions: pending.map((submission) => {
      const questions = parseQuestions(submission.assignment.questions);
      const answers = Array.isArray(submission.answers) ? submission.answers : [];
      const auto = (submission.questionScores ?? []) as unknown as QuestionResult[];

      return {
        id: submission.id,
        submittedAt: submission.submittedAt,
        student: {
          name: submission.student.user?.name ?? null,
          studentCode: submission.student.studentCode,
          level: submission.student.level,
        },
        assignment: { id: submission.assignment.id, title: submission.assignment.title },
        // Only the questions that actually need a human. The auto-marked ones
        // are already settled and would just be noise in a marking queue.
        toMark: questions
          .map((question, index) => ({ question, index }))
          .filter(({ question }) => question.type === "paragraph")
          .map(({ question, index }) => ({
            index,
            prompt: question.prompt,
            points: question.points,
            guidance: question.type === "paragraph" ? question.guidance ?? null : null,
            answer: typeof answers[index] === "string" ? (answers[index] as string) : "",
          })),
        autoEarned: auto.reduce((sum, entry) => sum + (entry?.earned ?? 0), 0),
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  try {
    const { submissionId, marks, feedback } = await req.json();
    if (!submissionId) {
      return NextResponse.json({ error: "submissionId is required" }, { status: 400 });
    }

    const submission = await prisma.assignmentSubmission.findUnique({
      where: { id: String(submissionId) },
      include: { assignment: { select: { questions: true, type: true } } },
    });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }
    if (!submission.needsReview) {
      return NextResponse.json(
        { error: "This paper has already been marked." },
        { status: 409 },
      );
    }

    const questions = parseQuestions(submission.assignment.questions);
    const auto = (submission.questionScores ?? []) as unknown as QuestionResult[];

    // finaliseScore clamps each mark to what its question is worth, so a
    // mistyped 100 in a box worth 10 cannot invent marks.
    const final = finaliseScore(questions, auto, marks);

    // Fold the awarded marks back into the per-question record, so the paper
    // can be re-read later as a whole rather than as auto marks plus a total.
    const merged = questions.map((question, index) => {
      if (question.type !== "paragraph") return auto[index] ?? null;
      const raw = Number(Array.isArray(marks) ? marks[index] : 0);
      const earned = Number.isFinite(raw) ? Math.max(0, Math.min(raw, question.points)) : 0;
      return { earned, possible: question.points, correct: earned === question.points, needsReview: false };
    });

    const updated = await prisma.assignmentSubmission.update({
      where: { id: submission.id },
      data: {
        score: final.score,
        questionScores: merged as unknown as object[],
        needsReview: false,
        markedById: auth.userId,
        markedAt: new Date(),
        feedback:
          typeof feedback === "string" && feedback.trim()
            ? feedback.trim()
            : `${final.earned} of ${final.possible} marks.`,
      },
    });

    // Only now does it reach the results page — the same rule the submit
    // route follows, so a provisional mark never becomes a transcript entry.
    try {
      await prisma.grade.create({
        data: {
          studentId: submission.studentId,
          type: "quiz",
          score: final.score,
          feedback: updated.feedback,
        },
      });
    } catch (error) {
      console.warn("Could not record marked quiz grade:", error);
    }

    // The one grading path that used to leave the student finding out by
    // opening the page and checking — see gradebook/route.ts and
    // grades/roster/route.ts, which already do this on every score change.
    await notify({
      to: { studentIds: [submission.studentId] },
      kind: KIND.resultPublished,
      severity: "info",
      title: "Your submission has been marked",
      message: "Your tutor finished marking your work. Open your results to see it.",
      link: "/results",
      dedupeKey: `submission-marked:${submission.id}`,
    }).catch((error) => console.error("Marking notification failed", error));

    return NextResponse.json({ score: final.score, earned: final.earned, possible: final.possible });
  } catch (error) {
    console.error("Marking failed:", error);
    return NextResponse.json({ error: "Unable to save the marks" }, { status: 500 });
  }
}
