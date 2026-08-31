import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { findPromotionCandidates, promoteStudents, SESSION_MONTHS } from "@/lib/promotion";
import { letterFor, PASS_MARK, weightedCourseworkAverage } from "@/lib/grading";

export const dynamic = "force-dynamic";

async function requireStudentsAdmin() {
  return requireCapability("students");
}

/** GET — students whose session has ended but who are still on the same level. */
export async function GET(req: NextRequest) {
  const gate = await requireStudentsAdmin();
  if (!gate.ok) return gate.response;

  try {
    const candidates = await findPromotionCandidates({
      branchId: req.nextUrl.searchParams.get("branchId"),
      level: req.nextUrl.searchParams.get("level"),
    });

    // Coursework standing, so the office does not promote a student who has not
    // passed the level they are leaving. Newest mark per skill, weighted — the
    // same figure the results page and the gradebook show.
    const ids = candidates.map((candidate) => candidate.studentId);
    const grades = ids.length
      ? await prisma.grade.findMany({
          where: { studentId: { in: ids }, examId: null },
          orderBy: { createdAt: "desc" },
          select: { studentId: true, type: true, score: true },
        })
      : [];
    const latestByStudent = new Map<string, Map<string, number>>();
    for (const grade of grades) {
      let marks = latestByStudent.get(grade.studentId);
      if (!marks) {
        marks = new Map();
        latestByStudent.set(grade.studentId, marks);
      }
      if (!marks.has(grade.type)) marks.set(grade.type, grade.score);
    }

    const enriched = candidates.map((candidate) => {
      const marks = latestByStudent.get(candidate.studentId);
      const courseworkAverage = weightedCourseworkAverage(
        marks ? [...marks.entries()].map(([type, score]) => ({ type, score })) : [],
      );
      return {
        ...candidate,
        courseworkAverage,
        courseworkGrade: courseworkAverage === null ? null : letterFor(courseworkAverage),
        belowPassMark: courseworkAverage !== null && courseworkAverage < PASS_MARK,
      };
    });

    return NextResponse.json({ candidates: enriched, sessionMonths: SESSION_MONTHS, passMark: PASS_MARK });
  } catch (error) {
    console.error("Promotion candidates GET failed:", error);
    return NextResponse.json({ error: "Unable to build the promotion list" }, { status: 500 });
  }
}

/** POST — move the given students up a level. */
export async function POST(req: NextRequest) {
  const gate = await requireStudentsAdmin();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const ids = Array.isArray(body?.studentIds) ? body.studentIds.filter((v: unknown) => typeof v === "string") : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: "Select at least one student" }, { status: 400 });
    }

    const result = await promoteStudents(ids);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Promotion POST failed:", error);
    return NextResponse.json({ error: "Unable to move these students" }, { status: 500 });
  }
}
