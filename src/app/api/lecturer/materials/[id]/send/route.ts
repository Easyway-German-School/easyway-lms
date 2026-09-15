import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveLecturerId } from "@/lib/lecturer";
import { KIND, notify } from "@/lib/notify";
import { belongsToLecturer, readAssignment, studentWhereForLecturer } from "@/lib/lecturer-assignment";
import {
  MATERIAL_AUDIENCE_SELECT,
  cohortMatchesAssignment,
  isOfficeCohortUpload,
} from "@/lib/material-audience";

/**
 * "Send this to my class" — a tutor manually pushing a material (their own,
 * or an office cohort upload that falls inside their assignment) to the
 * students on their roster RIGHT NOW.
 *
 * Why this exists on top of the automatic notify at upload time: that one
 * fires once, against the roster as it stood that moment. A student named
 * onto this tutor afterwards, or reassigned into their class later, never
 * saw it — the material sat visible in the tutor's own portal with no way
 * for them to catch that student up short of re-uploading. This re-runs the
 * same audience query live, so it always reaches exactly today's roster.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuthSession();
  if (!session || session.user.role !== "lecturer") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lecturerId = await resolveLecturerId(session.user.id);
  if (!lecturerId) {
    return NextResponse.json({ error: "Lecturer profile not found" }, { status: 404 });
  }

  const { id } = await params;
  const material = await prisma.material.findUnique({
    where: { id },
    select: { ...MATERIAL_AUDIENCE_SELECT, title: true, kind: true },
  });
  if (!material) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  const lecturer = await prisma.lecturer.findUnique({ where: { id: lecturerId } });
  const assignment = readAssignment(lecturer);

  const isMine = material.lecturerId === lecturerId;
  const isOffice = isOfficeCohortUpload(material) && cohortMatchesAssignment(material, assignment);
  if (!isMine && !isOffice) {
    return NextResponse.json({ error: "That is not one of your materials" }, { status: 403 });
  }
  if (!material.visibleToStudents) {
    return NextResponse.json({ error: "This material is staff-only and cannot go to students" }, { status: 400 });
  }

  const where = studentWhereForLecturer(assignment, lecturerId);
  if (!where) {
    return NextResponse.json({ error: "You have no class to send this to yet" }, { status: 400 });
  }

  const rows = await prisma.student.findMany({
    where: { ...(where as Record<string, unknown>), status: "active" } as never,
    select: {
      id: true,
      admission: true,
      tutorId: true,
      coTutors: { select: { lecturerId: true } },
      branchId: true,
      level: true,
      sessionSlot: true,
    },
  });

  // For an office cohort upload, narrow the roster down to the students this
  // MATERIAL is actually for (its own level / branch / sitting) — a tutor
  // covering two levels must not blast a B1-only handout at their A1 group
  // just because both are on the same roster query.
  const materialLevel = material.level ?? material.course?.level ?? null;
  const studentIds = rows
    .filter((row) => belongsToLecturer(assignment, lecturerId, row))
    .filter((row) => !materialLevel || row.level.toUpperCase() === materialLevel.toUpperCase())
    .filter((row) => !material.branchId || row.branchId === material.branchId)
    .filter((row) => !material.sessionSlot || row.sessionSlot === material.sessionSlot)
    .map((row) => row.id);

  if (!studentIds.length) {
    return NextResponse.json(
      { error: "None of your current students match this material's level and sitting" },
      { status: 400 },
    );
  }

  // Once per tutor per material per day — a click that only reaches stragglers
  // (students already notified keep silently skipping via the same key from
  // the original publish/office announce), not a fresh blast to everyone
  // every time a tutor revisits the page.
  const today = new Date().toISOString().slice(0, 10);
  const result = await notify({
    to: { studentIds },
    kind: KIND.materialPublished,
    severity: "info",
    title: material.kind === "recording" ? "A class recording is up" : "New material from your tutor",
    message:
      material.kind === "recording"
        ? `“${material.title}” is in your video library.`
        : `Your tutor shared “${material.title}”. Open Materials to see it.`,
    link: material.kind === "recording" ? "/materials?tab=watch" : "/materials",
    push: true,
    dedupeKey: `material:${material.id}:tutor-send:${lecturerId}:${today}`,
  });

  return NextResponse.json({
    success: true,
    sentTo: result.created,
    alreadyHadIt: result.skipped,
    rosterSize: studentIds.length,
  });
}
