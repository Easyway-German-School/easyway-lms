import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The marking queue: work a student has handed in that nobody has marked.
 *
 * The admin dashboard has counted this since it was built and had nowhere to
 * send anybody — the tile linked to the student roster, which is a list of
 * people rather than a list of unmarked papers, so the count was a number you
 * could read and not act on. The tutor gradebook covers one tutor's own
 * classes; this is the school-wide view, which is the one that answers "who is
 * behind on marking".
 *
 * Gated on `exams` rather than `students`: this is assessment oversight, and
 * the papers themselves are not the front desk's business.
 */
export async function GET(request: Request) {
  const gate = await requireCapability("exams");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const level = url.searchParams.get("level");
  const branchId = url.searchParams.get("branchId");
  const lecturerId = url.searchParams.get("lecturerId");

  const where: Record<string, unknown> = { score: null };
  if (level) where.assignment = { level };
  if (branchId) where.student = { branchId };
  if (lecturerId) {
    where.assignment = { ...(where.assignment as object ?? {}), lecturerId };
  }

  const submissions = await prisma.assignmentSubmission.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: 300,
    select: {
      id: true,
      createdAt: true,
      submittedAt: true,
      needsReview: true,
      submissionMode: true,
      text: true,
      fileName: true,
      assignment: {
        select: {
          id: true,
          title: true,
          type: true,
          level: true,
          dueAt: true,
          lecturer: { select: { id: true, user: { select: { name: true, email: true } } } },
        },
      },
      student: {
        select: {
          id: true,
          level: true,
          user: { select: { name: true, email: true } },
          branch: { select: { id: true, name: true } },
        },
      },
    },
  });

  const now = Date.now();

  const rows = submissions.map((submission) => {
    // `submittedAt` is when the student finished; `createdAt` is when the row
    // appeared, which for a timed quiz is when they STARTED it. Waiting time
    // measured from createdAt would age a paper by however long the student sat
    // the test, so the finish time is preferred wherever it exists.
    const handedIn = submission.submittedAt ?? submission.createdAt;
    return {
      id: submission.id,
      studentId: submission.student?.id ?? null,
      studentName: submission.student?.user?.name ?? "Unnamed",
      studentEmail: submission.student?.user?.email ?? "",
      branchId: submission.student?.branch?.id ?? null,
      branch: submission.student?.branch?.name ?? "Unassigned",
      level: submission.assignment?.level ?? submission.student?.level ?? "—",
      assignmentId: submission.assignment?.id ?? null,
      assignment: submission.assignment?.title ?? "Untitled",
      type: submission.assignment?.type ?? "document",
      dueAt: submission.assignment?.dueAt?.toISOString() ?? null,
      lecturerId: submission.assignment?.lecturer?.id ?? null,
      lecturer: submission.assignment?.lecturer?.user?.name ?? "Unassigned",
      handedInAt: handedIn.toISOString(),
      waitingDays: Math.max(0, Math.floor((now - handedIn.getTime()) / DAY_MS)),
      needsReview: submission.needsReview,
      mode: submission.submissionMode,
      hasWriting: Boolean(submission.text?.trim()),
      fileName: submission.fileName,
    };
  });

  /** Whose desk the backlog is sitting on. The question a head of school asks. */
  const byTutor = new Map<string, { id: string | null; name: string; waiting: number; oldestDays: number }>();
  for (const row of rows) {
    const key = row.lecturerId ?? "unassigned";
    const entry = byTutor.get(key) ?? { id: row.lecturerId, name: row.lecturer, waiting: 0, oldestDays: 0 };
    entry.waiting += 1;
    entry.oldestDays = Math.max(entry.oldestDays, row.waitingDays);
    byTutor.set(key, entry);
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totalCount: rows.length,
    rows,
    byTutor: [...byTutor.values()].sort((a, b) => b.waiting - a.waiting),
    canOpenStudentFiles: gate.admin.can("students"),
  });
}
