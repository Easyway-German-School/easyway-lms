import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { letterFor } from "@/lib/grading";
import { KIND, notify } from "@/lib/notify";
import {
  ASSESSMENT_TYPES,
  isAssessmentType,
  resolveRoster,
  UNASSIGNED_MESSAGE,
} from "@/lib/lecturer-roster";

/**
 * A tutor grading their own class.
 *
 * The grading pages that existed went Exam → ExamRegistration → Student, which
 * means a tutor could only enter a mark for a student who had booked an exam
 * sitting. Almost nobody has: the marks a tutor actually gives out week to week
 * are for classwork, speaking practice and mock papers that are not sittings at
 * all, so there was no route by which a tutor could record a score.
 *
 * This grades the ROSTER instead — the same admin-set assignment the register
 * and the class list read — so a tutor opens the page and their students are
 * already there.
 *
 * Scores entered here are `submissionMode: "physical"`: they were marked on
 * paper by a person, not computed from a submission on the platform, and the
 * results page says so rather than implying an audit trail that does not exist.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id || String(session.user.role ?? "").toLowerCase() !== "lecturer") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await resolveRoster(session.user.id);
  if (!resolved.ok) {
    if (resolved.reason === "unassigned") {
      return NextResponse.json({
        assigned: false,
        students: [],
        types: ASSESSMENT_TYPES,
        message: UNASSIGNED_MESSAGE,
      });
    }
    return NextResponse.json({ error: "Lecturer profile not found" }, { status: 404 });
  }

  const type = request.nextUrl.searchParams.get("type") ?? ASSESSMENT_TYPES[0];

  // Existing marks of this type, so re-opening the page shows what was
  // already entered rather than a blank grid inviting a duplicate.
  const existing = await prisma.grade.findMany({
    where: { studentId: { in: resolved.students.map((student) => student.id) }, type, examId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, studentId: true, score: true, feedback: true, createdAt: true },
  });
  // Newest per student wins — a tutor correcting a mark should see the
  // correction, not the first attempt.
  const latest = new Map<string, (typeof existing)[number]>();
  for (const grade of existing) if (!latest.has(grade.studentId)) latest.set(grade.studentId, grade);

  return NextResponse.json({
    assigned: true,
    types: ASSESSMENT_TYPES,
    type,
    students: resolved.students.map((student) => {
      const grade = latest.get(student.id);
      return {
        id: student.id,
        name: student.name,
        email: student.email,
        studentCode: student.studentCode,
        level: student.level,
        sessionSlot: student.sessionSlot,
        score: grade?.score ?? null,
        letter: grade ? letterFor(grade.score) : null,
        feedback: grade?.feedback ?? "",
        gradedAt: grade?.createdAt?.toISOString() ?? null,
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id || String(session.user.role ?? "").toLowerCase() !== "lecturer") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await resolveRoster(session.user.id);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.reason === "unassigned" ? UNASSIGNED_MESSAGE : "Lecturer profile not found" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type : "";
  const grades = Array.isArray(body?.grades) ? body.grades : [];

  if (!isAssessmentType(type)) {
    return NextResponse.json(
      { error: `Assessment type must be one of ${ASSESSMENT_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  // A tutor may only mark their own students. Without this the ids come
  // straight off the request body and any tutor could write a score onto any
  // student in the school.
  const permitted = new Set(resolved.students.map((student) => student.id));

  const written: string[] = [];
  for (const entry of grades) {
    const studentId = typeof entry?.studentId === "string" ? entry.studentId : "";
    if (!permitted.has(studentId)) {
      return NextResponse.json(
        { error: "That list contains students who are not in your class." },
        { status: 403 },
      );
    }

    // A blank score is "not marked yet", not zero. Skipping it lets a tutor
    // save half a register without recording a fail for everyone absent.
    if (entry.score === null || entry.score === undefined || entry.score === "") continue;

    const score = Math.round(Number(entry.score));
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return NextResponse.json({ error: "Scores must be between 0 and 100." }, { status: 400 });
    }

    const feedback = typeof entry.feedback === "string" ? entry.feedback.trim() || null : null;

    // Grade has a unique index on (studentId, examId), which does not
    // constrain classwork rows — examId is null for all of them. So the update
    // is done by hand: find this student's existing mark of this type and
    // replace it, rather than stacking a new row on every save.
    const previous = await prisma.grade.findFirst({
      where: { studentId, type, examId: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (previous) {
      await prisma.grade.update({
        where: { id: previous.id },
        data: { score, grade: letterFor(score), feedback, submissionMode: "physical" },
      });
    } else {
      await prisma.grade.create({
        data: { studentId, type, score, grade: letterFor(score), feedback, submissionMode: "physical" },
      });
    }
    written.push(studentId);
  }

  if (written.length) {
    await notify({
      to: { studentIds: written },
      kind: KIND.resultPublished,
      severity: "info",
      title: `Your ${type} result is in`,
      message: "Your tutor has entered a new score. Open your results to see it.",
      link: "/results",
      push: true,
    }).catch((error) => console.error("Grade notification failed", error));
  }

  return NextResponse.json({ success: true, saved: written.length });
}
