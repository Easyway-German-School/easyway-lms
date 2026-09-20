import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { notify, KIND } from "@/lib/notify";
import { attributeTutorAction, tutorPhrase } from "@/lib/tutor-attribution";
import { recordSkillOutcome } from "@/lib/skill-mastery";
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
      assignment: { select: { id: true, title: true, type: true, questions: true, level: true } },
    },
  });

  return NextResponse.json({
    submissions: pending.map((submission) => {
      const isQuiz = submission.assignment.type === "quiz";
      const questions = isQuiz ? parseQuestions(submission.assignment.questions) : [];
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
        assignment: { id: submission.assignment.id, title: submission.assignment.title, type: submission.assignment.type },
        // Only the questions that actually need a human. The auto-marked ones
        // are already settled and would just be noise in a marking queue.
        // Empty for a document — it has no questions at all, see `document`.
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
        // A document has no questions to walk — what the tutor has to read is
        // the whole handed-in thing: the written text and/or the attached file.
        document: isQuiz
          ? null
          : { text: submission.text, filePath: submission.filePath, fileName: submission.fileName },
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  try {
    const { submissionId, marks, feedback, score } = await req.json();
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

    const isQuiz = submission.assignment.type === "quiz";

    let finalScore: number;
    let finalFeedback: string;
    let questionScoresUpdate: object[] | undefined;

    if (isQuiz) {
      const questions = parseQuestions(submission.assignment.questions);
      const auto = (submission.questionScores ?? []) as unknown as QuestionResult[];

      // finaliseScore clamps each mark to what its question is worth, so a
      // mistyped 100 in a box worth 10 cannot invent marks.
      const final = finaliseScore(questions, auto, marks);
      finalScore = final.score;

      // Fold the awarded marks back into the per-question record, so the
      // paper can be re-read later as a whole rather than as auto marks plus
      // a total.
      questionScoresUpdate = questions.map((question, index) => {
        if (question.type !== "paragraph") return auto[index] ?? null;
        const raw = Number(Array.isArray(marks) ? marks[index] : 0);
        const earned = Number.isFinite(raw) ? Math.max(0, Math.min(raw, question.points)) : 0;
        return { earned, possible: question.points, correct: earned === question.points, needsReview: false };
      }) as unknown as object[];

      finalFeedback =
        typeof feedback === "string" && feedback.trim()
          ? feedback.trim()
          : `${final.earned} of ${final.possible} marks.`;
    } else {
      // A document has no questions to weigh a score against, so the tutor
      // gives one holistic mark out of 100 — same scale as everything else on
      // the transcript (see Grade.score).
      const raw = Number(score);
      finalScore = Number.isFinite(raw) ? Math.max(0, Math.min(Math.round(raw), 100)) : 0;
      finalFeedback = typeof feedback === "string" && feedback.trim() ? feedback.trim() : `${finalScore} / 100.`;
    }

    const updated = await prisma.assignmentSubmission.update({
      where: { id: submission.id },
      data: {
        score: finalScore,
        ...(questionScoresUpdate ? { questionScores: questionScoresUpdate } : {}),
        needsReview: false,
        markedById: auth.userId,
        markedAt: new Date(),
        feedback: finalFeedback,
      },
    });

    // Only now does it reach the results page — the same rule the submit
    // route follows, so a provisional mark never becomes a transcript entry.
    try {
      await prisma.grade.create({
        data: {
          studentId: submission.studentId,
          type: isQuiz ? "quiz" : "assignment",
          score: finalScore,
          feedback: updated.feedback,
          lecturerId: auth.lecturerId,
        },
      });
      if (isQuiz) {
        void recordSkillOutcome({ studentId: submission.studentId, skill: "grammar", score: finalScore });
      }
    } catch (error) {
      console.warn("Could not record marked grade:", error);
    }

    // The one grading path that used to leave the student finding out by
    // opening the page and checking — see gradebook/route.ts and
    // grades/roster/route.ts, which already do this on every score change.
    const attribution = await attributeTutorAction(submission.studentId, auth.lecturerId);
    await notify({
      to: { studentIds: [submission.studentId] },
      kind: KIND.resultPublished,
      severity: "info",
      title: "Your submission has been marked",
      message: `${tutorPhrase(attribution)} finished marking your work. Open your results to see it.`,
      link: "/results",
      dedupeKey: `submission-marked:${submission.id}`,
      push: true,
    }).catch((error) => console.error("Marking notification failed", error));

    return NextResponse.json({ score: finalScore });
  } catch (error) {
    console.error("Marking failed:", error);
    return NextResponse.json({ error: "Unable to save the marks" }, { status: 500 });
  }
}
