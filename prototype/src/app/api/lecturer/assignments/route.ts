import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { parseQuestions, totalPoints, type Question } from "@/lib/assignments";

/** Tutors create and review assignments for a level (optionally one branch). */

export const dynamic = "force-dynamic";

async function requireStaff() {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, lecturer: { select: { id: true } } },
  });
  const role = String(user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return { error: NextResponse.json({ error: "Staff access required" }, { status: 403 }) };
  }
  return { lecturerId: user?.lecturer?.id ?? null };
}

export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if (auth.error) return auth.error;

  const level = req.nextUrl.searchParams.get("level");

  const assignments = await prisma.assignment.findMany({
    where: level ? { level } : {},
    orderBy: { createdAt: "desc" },
    include: {
      branch: { select: { id: true, name: true } },
      _count: { select: { submissions: true } },
      targets: {
        select: {
          student: {
            select: { id: true, studentCode: true, user: { select: { name: true } } },
          },
        },
      },
      submissions: {
        where: { submittedAt: { not: null } },
        select: {
          id: true,
          score: true,
          needsReview: true,
          submittedAt: true,
          student: { select: { studentCode: true, user: { select: { name: true } } } },
        },
        orderBy: { submittedAt: "desc" },
      },
    },
  });

  return NextResponse.json({
    assignments: assignments.map((assignment) => ({
      ...assignment,
      questionCount: parseQuestions(assignment.questions).length,
      totalPoints: totalPoints(parseQuestions(assignment.questions)),
      // Flattened so the list can say "set for 6 students" without the caller
      // digging through the join rows.
      targetStudents: assignment.targets.map((target) => ({
        id: target.student.id,
        name: target.student.user?.name ?? null,
        studentCode: target.student.studentCode,
      })),
      awaitingMarking: assignment.submissions.filter((s) => s.needsReview).length,
    })),
  });
}

/**
 * Everything that makes a set of questions markable.
 *
 * Checked here rather than trusted from the builder, because the builder is a
 * browser and a browser is not where correctness lives. A question that cannot
 * be marked — no correct option ticked, no accepted spelling given — silently
 * scores every student zero, and nobody finds out until the results are
 * already wrong.
 */
function questionProblem(questions: Question[]): string | null {
  if (questions.length === 0) {
    return "Add at least one complete question. Check every question has its wording filled in, and that choice questions have at least two options.";
  }

  for (const [index, question] of questions.entries()) {
    const where = `Question ${index + 1}`;

    if (question.type === "choice" && (question.answerIndex < 0 || question.answerIndex >= question.options.length)) {
      return `${where}: tick the correct option.`;
    }
    if (question.type === "multi" && question.answerIndexes.length === 0) {
      return `${where}: tick at least one correct option.`;
    }
    if (question.type === "short" && question.accepted.length === 0) {
      return `${where}: give at least one accepted answer.`;
    }
  }

  return null;
}

/** Narrow a list of student ids to the ones that really exist at this level. */
async function resolveTargets(studentIds: unknown, level: string): Promise<string[]> {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return [];

  const ids = studentIds.map((id) => String(id)).filter(Boolean);
  if (ids.length === 0) return [];

  // Filtered by level as well as id: a tutor should not be able to set an A1
  // paper for a B2 student by posting an id the picker never offered.
  const students = await prisma.student.findMany({
    where: { id: { in: ids }, level },
    select: { id: true },
  });

  return students.map((student) => student.id);
}

export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { title, description, level, branchId, type, timeLimitMinutes, questions, dueAt, studentIds } = body;

    if (!title || !level) {
      return NextResponse.json({ error: "title and level are required" }, { status: 400 });
    }

    const kind = type === "quiz" ? "quiz" : "document";
    const normalizedLevel = String(level).toUpperCase();
    const parsed = kind === "quiz" ? parseQuestions(questions) : [];

    if (kind === "quiz") {
      const problem = questionProblem(parsed);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const targetIds = await resolveTargets(studentIds, normalizedLevel);

    const created = await prisma.assignment.create({
      data: {
        title: String(title).trim(),
        description: typeof description === "string" ? description.trim() || null : null,
        level: normalizedLevel,
        branchId: branchId || null,
        type: kind,
        timeLimitMinutes: kind === "quiz" && timeLimitMinutes ? Number(timeLimitMinutes) : null,
        questions: kind === "quiz" ? (parsed as object[]) : undefined,
        dueAt: dueAt ? new Date(dueAt) : null,
        lecturerId: auth.lecturerId ?? null,
        targets: targetIds.length ? { create: targetIds.map((studentId) => ({ studentId })) } : undefined,
      },
    });

    return NextResponse.json({ assignment: created, targeted: targetIds.length });
  } catch (error) {
    console.error("Lecturer assignment POST failed:", error);
    return NextResponse.json({ error: "Unable to create the assignment" }, { status: 500 });
  }
}

/**
 * Edit an assignment.
 *
 * Refused once anybody has handed it in. Changing the questions under a
 * submitted paper would re-mark it against a test the student never sat, and
 * silently rewrite a result they may already have been told.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireStaff();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { id, title, description, timeLimitMinutes, questions, dueAt, published, studentIds } = body;

    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const existing = await prisma.assignment.findUnique({
      where: { id: String(id) },
      select: { id: true, type: true, level: true, _count: { select: { submissions: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    const hasSubmissions = existing._count.submissions > 0;
    const wantsQuestionChange = questions !== undefined;

    if (hasSubmissions && wantsQuestionChange) {
      return NextResponse.json(
        {
          error:
            "Students have already started this, so the questions cannot be changed. Unpublish it and set a new one instead.",
        },
        { status: 409 },
      );
    }

    let parsed: Question[] | undefined;
    if (wantsQuestionChange && existing.type === "quiz") {
      parsed = parseQuestions(questions);
      const problem = questionProblem(parsed);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const updated = await prisma.assignment.update({
      where: { id: existing.id },
      data: {
        ...(title !== undefined ? { title: String(title).trim() } : {}),
        ...(description !== undefined
          ? { description: typeof description === "string" ? description.trim() || null : null }
          : {}),
        ...(timeLimitMinutes !== undefined
          ? { timeLimitMinutes: timeLimitMinutes ? Number(timeLimitMinutes) : null }
          : {}),
        ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
        ...(published !== undefined ? { published: Boolean(published) } : {}),
        ...(parsed ? { questions: parsed as object[] } : {}),
      },
    });

    // Targets are replaced wholesale rather than diffed: the builder always
    // sends the full list, and a diff would need a delete path anyway.
    if (studentIds !== undefined) {
      const targetIds = await resolveTargets(studentIds, existing.level);
      await prisma.assignmentTarget.deleteMany({ where: { assignmentId: existing.id } });
      if (targetIds.length) {
        await prisma.assignmentTarget.createMany({
          data: targetIds.map((studentId) => ({ assignmentId: existing.id, studentId })),
          skipDuplicates: true,
        });
      }
    }

    return NextResponse.json({ assignment: updated });
  } catch (error) {
    console.error("Lecturer assignment PATCH failed:", error);
    return NextResponse.json({ error: "Unable to update the assignment" }, { status: 500 });
  }
}
