import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";

/**
 * Release (or hide) an exam sitting's results.
 *
 * Exam-linked grades stay invisible on the student's results page until
 * `resultsReleased` is true — a tutor keys a whole sitting in, checks it, and
 * publishes the lot in one go rather than the student watching scores appear
 * one classmate at a time. Coursework marks are not gated this way; they show
 * the moment they are saved.
 *
 * On release the graded students are notified, the same as a coursework mark —
 * without this a tutor flips the toggle and nobody finds out their result is
 * up.
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
    select: { id: true, name: true, resultsReleased: true },
  });
  if (!exam) return NextResponse.json({ error: "Exam not found" }, { status: 404 });

  const updated = await prisma.exam.update({
    where: { id: exam.id },
    data: { resultsReleased: !exam.resultsReleased },
    select: { id: true, resultsReleased: true },
  });

  // Tell the students only when results have just gone live, and only those
  // who actually have a mark for this sitting.
  if (updated.resultsReleased) {
    const graded = await prisma.grade.findMany({
      where: { examId: exam.id },
      select: { studentId: true },
    });
    const studentIds = [...new Set(graded.map((row) => row.studentId))];
    if (studentIds.length) {
      await notify({
        to: { studentIds },
        kind: KIND.resultPublished,
        severity: "info",
        title: `${exam.name} results are out`,
        message: "Your tutor has released this exam's results. Open your results to see your score.",
        link: "/results",
        push: true,
      }).catch((error) => console.error("Result release notification failed", error));
    }
  }

  return NextResponse.json({ examId: updated.id, resultsReleased: updated.resultsReleased });
}
