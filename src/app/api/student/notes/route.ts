import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * The My Notes hub feed. Two lists:
 *
 *   `recaps` — the AI recap for every class recording this student owns, even
 *              ones whose 2-week video window has passed. This is where "the
 *              notes stay" is delivered: the recording leaves the shelf, the
 *              recap does not.
 *   `notes`  — every notebook entry the student has actually written into,
 *              across recordings AND ready-made notes.
 *
 * The ready-made notes list (from tutors' documents) has its own endpoint,
 * `/api/student/study-notes`.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, level: true },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const ownScope = [
    { level: student.level },
    { course: { level: student.level } },
    { privateClasses: { some: { studentId: student.id } } },
  ];

  const recapRows = await prisma.material.findMany({
    where: {
      kind: "recording",
      OR: ownScope,
      recording: { transcript: { status: "ready" } },
    },
    orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      level: true,
      recordedAt: true,
      recording: {
        select: {
          privateClassId: true,
          studentExpiresAt: true,
          keepForever: true,
          transcript: { select: { summary: true } },
        },
      },
    },
  });

  const now = Date.now();
  const recaps = recapRows.map((row) => ({
    materialId: row.id,
    title: row.title,
    level: row.level,
    isPrivate: Boolean(row.recording?.privateClassId),
    recordedAt: row.recordedAt,
    // Whether the video is still on the shelf — the recap is here either way.
    videoExpired: Boolean(
      row.recording &&
        !row.recording.keepForever &&
        row.recording.studentExpiresAt &&
        row.recording.studentExpiresAt.getTime() <= now,
    ),
    preview: (row.recording?.transcript?.summary ?? "").trim().slice(0, 160),
  }));

  const rows = await prisma.studentClassNote.findMany({
    where: { studentId: student.id, content: { not: "" } },
    orderBy: { updatedAt: "desc" },
    select: {
      materialId: true,
      content: true,
      updatedAt: true,
      material: {
        select: {
          title: true,
          kind: true,
          level: true,
          recordedAt: true,
          recording: { select: { privateClassId: true } },
        },
      },
    },
  });

  const notes = rows
    .filter((row) => row.material)
    .map((row) => ({
      materialId: row.materialId,
      title: row.material!.title,
      kind: row.material!.kind,
      isPrivate: Boolean(row.material!.recording?.privateClassId),
      level: row.material!.level,
      updatedAt: row.updatedAt,
      preview: row.content.trim().slice(0, 160),
    }));

  return NextResponse.json({ recaps, notes });
}
