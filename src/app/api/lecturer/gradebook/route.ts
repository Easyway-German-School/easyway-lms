import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { letterFor, PASS_MARK } from "@/lib/grading";
import { KIND, notify } from "@/lib/notify";
import {
  ASSESSMENT_TYPES,
  ASSESSMENT_WEIGHTS as WEIGHTS,
  REQUIRED_ASSESSMENT_TYPES,
  isAssessmentType,
  isRequiredAssessmentType,
  resolveRoster,
  UNASSIGNED_MESSAGE,
} from "@/lib/lecturer-roster";

/**
 * The tutor's gradebook.
 *
 * WHAT THIS REPLACED. The old version listed every course in the shared
 * "Lecturer Uploaded Courses" pathway — so every tutor in the school saw every
 * other tutor's courses — and the only figures in it were lesson-completion
 * percentages. A tutor could not read a mark off it, could not enter one, and
 * the students in it were whoever happened to have a Progress row rather than
 * whoever was in their class. It was a progress report labelled "gradebook".
 *
 * This is the actual book of marks: the tutor's own roster down the side, one
 * column per kind of assessment, marks in the cells. Everything it shows is
 * derived from Grade rows, so it agrees with the student's results page by
 * construction rather than by coincidence.
 *
 * Attendance rides along in the same payload. A mark and an attendance record
 * answer the same question from two directions — "is this student going to be
 * ready?" — and a tutor should not have to hold two pages open to see it.
 */

export const dynamic = "force-dynamic";

type Cell = { score: number; letter: string; feedback: string | null; markedAt: string };

type LecturerGradebookAuth = { error: NextResponse } | { userId: string };

async function requireLecturer(): Promise<LecturerGradebookAuth> {
  const session = await requireAuthSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const userId = session?.user?.id;
  const role = String(session?.user?.role ?? "").toLowerCase();
  if (!userId || !(role === "lecturer" || role === "admin")) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId };
}

export async function GET() {
  const auth = await requireLecturer();
  if ("error" in auth) return auth.error;

  const roster = await resolveRoster(auth.userId);
  if (!roster.ok) {
    return NextResponse.json({
      assigned: false,
      types: ASSESSMENT_TYPES,
      students: [],
      message:
        roster.reason === "unassigned"
          ? UNASSIGNED_MESSAGE
          : "No tutor profile is attached to this account. The office can fix this from Tutors.",
    });
  }

  const studentIds = roster.students.map((student) => student.id);
  if (studentIds.length === 0) {
    return NextResponse.json({
      assigned: true,
      types: ASSESSMENT_TYPES,
      weights: WEIGHTS,
      passMark: PASS_MARK,
      students: [],
      columns: [],
      classStats: null,
      message: "Nobody is registered for your class yet.",
    });
  }

  // Everything in one pass rather than a query per student — a class of forty
  // was forty round trips in the version this replaced.
  const [grades, attendance] = await Promise.all([
    prisma.grade.findMany({
      where: { studentId: { in: studentIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        studentId: true,
        type: true,
        score: true,
        feedback: true,
        createdAt: true,
        examId: true,
        exam: { select: { id: true, name: true, examDate: true, examBody: true, resultsReleased: true } },
      },
    }),
    prisma.attendance.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, present: true, status: true },
    }),
  ]);

  /** Latest mark per (student, type) — a correction replaces, it does not stack. */
  const cells = new Map<string, Cell>();
  /** Every classwork mark a student has had, for the trend and sparkline. */
  const history = new Map<string, Array<{ score: number; at: number }>>();
  const examRows = new Map<
    string,
    Array<{ id: string; name: string; score: number; letter: string; at: string; body: string; resultsReleased: boolean }>
  >();

  for (const grade of grades) {
    if (grade.examId && grade.exam) {
      const list = examRows.get(grade.studentId) ?? [];
      list.push({
        id: grade.exam.id,
        name: grade.exam.name,
        score: grade.score,
        letter: letterFor(grade.score),
        at: grade.exam.examDate.toISOString(),
        body: grade.exam.examBody,
        resultsReleased: grade.exam.resultsReleased,
      });
      examRows.set(grade.studentId, list);
      continue;
    }

    const key = `${grade.studentId}:${grade.type}`;
    // The query came back newest first, so the first one seen wins.
    if (!cells.has(key)) {
      cells.set(key, {
        score: grade.score,
        letter: letterFor(grade.score),
        feedback: grade.feedback,
        markedAt: grade.createdAt.toISOString(),
      });
    }

    const trail = history.get(grade.studentId) ?? [];
    trail.push({ score: grade.score, at: grade.createdAt.getTime() });
    history.set(grade.studentId, trail);
  }

  const attendanceBy = new Map<string, { held: number; present: number; late: number }>();
  for (const row of attendance) {
    const tally = attendanceBy.get(row.studentId) ?? { held: 0, present: 0, late: 0 };
    tally.held += 1;
    if (row.present) tally.present += 1;
    if (row.status === "late") tally.late += 1;
    attendanceBy.set(row.studentId, tally);
  }

  const students = roster.students.map((student) => {
    const marks: Record<string, Cell | null> = {};
    let weighted = 0;
    let weight = 0;
    let marked = 0;
    // Owed marks are counted against the four core skills only. A quiz or a
    // mock is something a tutor sets when they set it — dropping it into the
    // "marks owed" figure would light the dashboard tile red for every class
    // that simply has not run a mock this fortnight.
    let requiredMarked = 0;

    for (const type of ASSESSMENT_TYPES) {
      const cell = cells.get(`${student.id}:${type}`) ?? null;
      marks[type] = cell;
      if (cell) {
        weighted += cell.score * WEIGHTS[type];
        weight += WEIGHTS[type];
        marked += 1;
        if (isRequiredAssessmentType(type)) requiredMarked += 1;
      }
    }

    const average = weight > 0 ? Math.round(weighted / weight) : null;

    /**
     * Which way they are going: the last two marks in chronological order,
     * whatever type they were. A tutor scanning a class of thirty wants to
     * know who slipped this week, and an average hides that completely.
     */
    const trail = (history.get(student.id) ?? []).sort((a, b) => a.at - b.at);
    const trend =
      trail.length >= 2 ? trail[trail.length - 1].score - trail[trail.length - 2].score : null;

    const tally = attendanceBy.get(student.id);

    return {
      id: student.id,
      name: student.name,
      email: student.email,
      studentCode: student.studentCode,
      level: student.level,
      sessionSlot: student.sessionSlot,
      marks,
      average,
      letter: average === null ? null : letterFor(average),
      passing: average === null ? null : average >= PASS_MARK,
      marked,
      outstanding: REQUIRED_ASSESSMENT_TYPES.length - requiredMarked,
      trend,
      // Oldest→newest, for the sparkline. Capped so one long history cannot
      // make the payload the biggest thing on the page.
      sparkline: trail.slice(-12).map((point) => point.score),
      attendance: tally
        ? {
            held: tally.held,
            present: tally.present,
            late: tally.late,
            percent: Math.round((tally.present / tally.held) * 100),
          }
        : null,
      exams: examRows.get(student.id) ?? [],
    };
  });

  /** Per-column figures, so a tutor can see which skill the class is weak at. */
  const columns = ASSESSMENT_TYPES.map((type) => {
    const scores = students
      .map((student) => student.marks[type]?.score)
      .filter((score): score is number => typeof score === "number");
    return {
      type,
      required: isRequiredAssessmentType(type),
      marked: scores.length,
      missing: students.length - scores.length,
      average: scores.length
        ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
        : null,
      passRate: scores.length
        ? Math.round((scores.filter((score) => score >= PASS_MARK).length / scores.length) * 100)
        : null,
    };
  });

  const averages = students
    .map((student) => student.average)
    .filter((average): average is number => typeof average === "number");

  const classStats = {
    students: students.length,
    graded: averages.length,
    ungraded: students.length - averages.length,
    average: averages.length
      ? Math.round(averages.reduce((sum, value) => sum + value, 0) / averages.length)
      : null,
    highest: averages.length ? Math.max(...averages) : null,
    lowest: averages.length ? Math.min(...averages) : null,
    passRate: averages.length
      ? Math.round((averages.filter((value) => value >= PASS_MARK).length / averages.length) * 100)
      : null,
    // How many marks are still owed across the whole book — the number a tutor
    // is actually judged on, and it was nowhere before.
    outstanding: students.reduce((sum, student) => sum + student.outstanding, 0),
    distribution: ["A", "B", "C", "D", "F"].map((letter) => ({
      letter,
      count: students.filter((student) => student.letter === letter).length,
    })),
  };

  return NextResponse.json({
    assigned: true,
    types: ASSESSMENT_TYPES,
    weights: WEIGHTS,
    passMark: PASS_MARK,
    students,
    columns,
    classStats,
  });
}

/**
 * Write one cell.
 *
 * Single-cell rather than whole-form: the gradebook is a grid a tutor tabs
 * through, and a page that only saves on a "save everything" button loses the
 * lot when a phone locks halfway down a class of thirty.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireLecturer();
  if ("error" in auth) return auth.error;

  const roster = await resolveRoster(auth.userId);
  if (!roster.ok) {
    return NextResponse.json(
      { error: roster.reason === "unassigned" ? UNASSIGNED_MESSAGE : "No tutor profile found." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    studentId?: unknown;
    type?: unknown;
    score?: unknown;
    feedback?: unknown;
  } | null;

  const studentId = typeof body?.studentId === "string" ? body.studentId : "";
  const type = typeof body?.type === "string" ? body.type : "";

  // A tutor may only mark their own students. Without this the id comes
  // straight off the request body and any tutor could write onto any student
  // in the school.
  if (!roster.students.some((student) => student.id === studentId)) {
    return NextResponse.json({ error: "That student is not in your class." }, { status: 403 });
  }
  if (!isAssessmentType(type)) {
    return NextResponse.json({ error: "Unknown assessment type." }, { status: 400 });
  }

  const feedback = typeof body?.feedback === "string" ? body.feedback.trim() || null : undefined;

  const existing = await prisma.grade.findFirst({
    where: { studentId, type, examId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, score: true },
  });

  // Clearing a cell. Blank is "not marked yet" and has to be reachable — a
  // tutor who typed into the wrong row needs a way back to empty that is not
  // "type 0", which is a fail on the student's permanent record.
  if (body?.score === null || body?.score === "") {
    if (existing) await prisma.grade.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true, cell: null });
  }

  const score = Math.round(Number(body?.score));
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return NextResponse.json({ error: "Scores must be between 0 and 100." }, { status: 400 });
  }

  const saved = existing
    ? await prisma.grade.update({
        where: { id: existing.id },
        data: {
          score,
          grade: letterFor(score),
          ...(feedback === undefined ? {} : { feedback }),
          submissionMode: "physical",
        },
      })
    : await prisma.grade.create({
        data: {
          studentId,
          type,
          score,
          grade: letterFor(score),
          feedback: feedback ?? null,
          submissionMode: "physical",
        },
      });

  // Only tell them when the number actually moved. A tutor tabbing back
  // through a row they already filled in should not fire a notification per
  // cell they pass over.
  if (!existing || existing.score !== score) {
    await notify({
      to: { studentIds: [studentId] },
      kind: KIND.resultPublished,
      severity: "info",
      title: `Your ${type} mark is in`,
      message: "Your tutor has entered a new score. Open your results to see it.",
      link: "/results",
      push: true,
    }).catch((error) => console.error("Grade notification failed", error));
  }

  return NextResponse.json({
    success: true,
    cell: {
      score: saved.score,
      letter: letterFor(saved.score),
      feedback: saved.feedback,
      markedAt: saved.createdAt.toISOString(),
    },
  });
}
