import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setExamResultsReleased } from "@/lib/result-release";

/**
 * Release (or hide) an exam sitting's results.
 *
 * Exam-linked grades stay invisible on the student's results page until
 * `resultsReleased` is true — a tutor keys a whole sitting in, checks it, and
 * publishes the lot in one go rather than the student watching scores appear
 * one classmate at a time. Coursework marks are not gated this way; they show
 * the moment they are saved.
 *
 * The flip and every notification that rides on it — the graded students, THEIR
 * PARENTS, and the office — live in `setExamResultsReleased` so this manual
 * toggle and the automatic release sweep (src/lib/result-release.ts) can never
 * drift apart. This route only decides whether the caller is allowed to flip
 * THIS sitting.
 */
export async function POST(request: Request) {
  const session = await requireAuthSession();
  const role = String(session?.user?.role ?? "").toLowerCase();
  if (!session?.user?.id || (role !== "lecturer" && role !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const examId = String(body.examId ?? "");
  if (!examId) return NextResponse.json({ error: "Exam ID required" }, { status: 400 });

  const exam = await prisma.exam.findFirst({
    where: { id: examId, ...(role === "lecturer" ? { lecturer: { userId: session.user.id } } : {}) },
    select: { id: true, resultsReleased: true },
  });
  if (!exam) return NextResponse.json({ error: "Exam not found" }, { status: 404 });

  const next = !exam.resultsReleased;
  await setExamResultsReleased(exam.id, next).catch((error) =>
    console.error("Result release failed", error),
  );

  return NextResponse.json({ examId: exam.id, resultsReleased: next });
}
