import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { EXAM_BODIES } from "@/lib/exam-centre";
import { letterFor } from "@/lib/grading";
import { isExamBodyLive } from "@/lib/tenant/features";
import { featuresForCurrentTenant } from "@/lib/tenant/features-server";

/**
 * Staff view of exams: schedule sittings, manage the roster, enter results.
 *
 * The single canonical exam API — it replaces two earlier admin routes
 * (`/api/admin/exams` and `/api/admin/exam-registrations`) that wrote
 * `ExamRegistration` rows with no `examId`, bypassing capacity, payment and
 * publish checks entirely. Everything here goes through a real `Exam` row.
 */

export const dynamic = "force-dynamic";

const SKILLS = ["reading", "listening", "writing", "speaking"] as const;

async function requireExamAdmin() {
  const gate = await requireCapability("exams");
  if (!gate.ok) return gate.response;
  return { userId: gate.session.user.id as string };
}

export async function GET() {
  const auth = await requireExamAdmin();
  if (auth instanceof NextResponse) return auth;

  const features = await featuresForCurrentTenant();

  const [exams, branches] = await Promise.all([
    prisma.exam.findMany({
      orderBy: { examDate: "desc" },
      include: {
        branch: { select: { id: true, name: true } },
        registrations: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, studentId: true, seatNumber: true, status: true, paymentStatus: true,
            candidateName: true, candidateEmail: true,
            student: { select: { studentCode: true, user: { select: { name: true, email: true } } } },
          },
        },
        grades: {
          select: {
            studentId: true, score: true, grade: true,
            readingScore: true, listeningScore: true, writingScore: true, speakingScore: true,
          },
        },
      },
    }),
    prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // Global stats across internal sittings only — ÖSD/telc results are the
  // awarding body's own record, not something this school grades.
  let graded = 0;
  let passed = 0;
  const skillTotals = { reading: 0, listening: 0, writing: 0, speaking: 0 };
  let published = 0;
  let booked = 0;
  let noShows = 0;

  const examsOut = exams.map((e) => {
    const held = e.registrations.filter((r) => r.status !== "cancelled").length;
    if (e.published) published += 1;
    booked += held;
    noShows += e.registrations.filter((r) => r.status === "no_show").length;

    const gradeByStudent = new Map(e.grades.map((g) => [g.studentId, g]));
    if (e.examBody === "internal") {
      for (const g of e.grades) {
        if (g.readingScore == null || g.listeningScore == null || g.writingScore == null || g.speakingScore == null) continue;
        graded += 1;
        skillTotals.reading += g.readingScore;
        skillTotals.listening += g.listeningScore;
        skillTotals.writing += g.writingScore;
        skillTotals.speaking += g.speakingScore;
        const allPass = [g.readingScore, g.listeningScore, g.writingScore, g.speakingScore].every((s) => s >= e.passThreshold);
        if (allPass) passed += 1;
      }
    }

    return {
      ...e,
      taken: held,
      remaining: e.capacity === null ? null : Math.max(0, e.capacity - held),
      registrations: e.registrations.map((r) => ({ ...r, grade: r.studentId ? gradeByStudent.get(r.studentId) ?? null : null })),
    };
  });

  return NextResponse.json({
    exams: examsOut,
    branches,
    bodies: EXAM_BODIES,
    liveBodies: EXAM_BODIES.filter((body) => isExamBodyLive(features, body)),
    stats: {
      published,
      booked,
      noShows,
      passRate: graded > 0 ? Math.round((passed / graded) * 100) : null,
      avgReading: graded > 0 ? Math.round(skillTotals.reading / graded) : null,
      avgListening: graded > 0 ? Math.round(skillTotals.listening / graded) : null,
      avgWriting: graded > 0 ? Math.round(skillTotals.writing / graded) : null,
      avgSpeaking: graded > 0 ? Math.round(skillTotals.speaking / graded) : null,
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireExamAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const b = await req.json();
    if (!b.name?.trim() || !b.examDate) {
      return NextResponse.json({ error: "A name and exam date are required" }, { status: 400 });
    }

    const examDate = new Date(b.examDate);
    const deadline = b.registrationDeadline ? new Date(b.registrationDeadline) : null;

    if (deadline && deadline > examDate) {
      return NextResponse.json(
        { error: "The registration deadline cannot be after the exam date." },
        { status: 400 },
      );
    }

    // A mock (pretest) sitting always grades internally, and its results start
    // hidden so the automatic release delay actually has something to delay.
    const isMock = b.kind === "mock";

    const exam = await prisma.exam.create({
      data: {
        name: String(b.name).trim(),
        description: b.description?.trim() || null,
        examDate,
        kind: isMock ? "mock" : "standard",
        examBody: isMock
          ? "internal"
          : (EXAM_BODIES as readonly string[]).includes(b.examBody)
            ? b.examBody
            : "internal",
        level: b.level || null,
        branchId: b.branchId || null,
        fee: b.fee ? Number(b.fee) : null,
        capacity: b.capacity ? Number(b.capacity) : null,
        registrationDeadline: deadline,
        published: Boolean(b.published),
        resultsReleased: isMock ? false : true,
        passThreshold: b.passThreshold ? Number(b.passThreshold) : 60,
      },
    });

    return NextResponse.json({ exam });
  } catch (error) {
    console.error("Exam create failed:", error);
    return NextResponse.json({ error: "Unable to create that sitting" }, { status: 500 });
  }
}

/** PATCH — publish/unpublish, edit the pass threshold, mark a registration paid, or enter results. */
export async function PATCH(req: NextRequest) {
  const auth = await requireExamAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { examId, published, passThreshold, registrationId, paymentStatus, status, results } = await req.json();

    if (registrationId && results) {
      for (const skill of SKILLS) {
        const v = results[skill];
        if (typeof v !== "number" || v < 0 || v > 100) {
          return NextResponse.json({ error: `${skill[0].toUpperCase()}${skill.slice(1)} score must be 0-100.` }, { status: 400 });
        }
      }

      const registration = await prisma.examRegistration.findUnique({
        where: { id: registrationId },
        include: { exam: true },
      });
      if (!registration || !registration.exam) {
        return NextResponse.json({ error: "Registration not found" }, { status: 404 });
      }
      if (!registration.studentId) {
        return NextResponse.json(
          { error: "Results can only be recorded for enrolled students, not external candidates." },
          { status: 400 },
        );
      }
      if (registration.exam.examBody !== "internal") {
        return NextResponse.json(
          { error: "ÖSD/telc results are the awarding body's own record, not entered here." },
          { status: 400 },
        );
      }

      const overall = Math.min(results.reading, results.listening, results.writing, results.speaking);

      const grade = await prisma.grade.upsert({
        where: { studentId_examId: { studentId: registration.studentId, examId: registration.exam.id } },
        create: {
          studentId: registration.studentId,
          examId: registration.exam.id,
          type: "exam",
          score: overall,
          grade: letterFor(overall),
          readingScore: results.reading,
          listeningScore: results.listening,
          writingScore: results.writing,
          speakingScore: results.speaking,
          submissionMode: "physical",
        },
        update: {
          score: overall,
          grade: letterFor(overall),
          readingScore: results.reading,
          listeningScore: results.listening,
          writingScore: results.writing,
          speakingScore: results.speaking,
        },
      });

      await prisma.examRegistration.update({ where: { id: registrationId }, data: { status: "completed" } });

      return NextResponse.json({ grade });
    }

    if (registrationId) {
      const updated = await prisma.examRegistration.update({
        where: { id: registrationId },
        data: {
          ...(paymentStatus ? { paymentStatus } : {}),
          ...(status ? { status } : {}),
        },
      });
      return NextResponse.json({ registration: updated });
    }

    if (examId) {
      const data: { published?: boolean; passThreshold?: number } = {};
      if (typeof published === "boolean") {
        if (published) {
          const exam = await prisma.exam.findUnique({ where: { id: examId }, select: { examDate: true } });
          if (exam && exam.examDate <= new Date()) {
            return NextResponse.json(
              { error: "That date has already passed — it cannot be published." },
              { status: 400 },
            );
          }
        }
        data.published = published;
      }
      if (typeof passThreshold === "number") {
        if (passThreshold < 0 || passThreshold > 100) {
          return NextResponse.json({ error: "Pass threshold must be 0-100." }, { status: 400 });
        }
        data.passThreshold = passThreshold;
      }
      if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      }
      const updated = await prisma.exam.update({ where: { id: examId }, data });
      return NextResponse.json({ exam: updated });
    }

    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  } catch (error) {
    console.error("Exam update failed:", error);
    return NextResponse.json({ error: "Unable to update" }, { status: 500 });
  }
}
