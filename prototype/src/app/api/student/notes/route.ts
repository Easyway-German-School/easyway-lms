import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Every notebook entry a student has actually written something into —
 * the list the sidebar's "My Notes" was missing. `StudentClassNote` rows
 * exist independently of AI notes finishing (see the model comment), so
 * this is a plain list of the student's own writing, not a view onto the
 * AI pipeline.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({ where: { userId: session.user.id } });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

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
      isPrivate: Boolean(row.material!.recording?.privateClassId),
      level: row.material!.level,
      updatedAt: row.updatedAt,
      preview: row.content.trim().slice(0, 160),
    }));

  return NextResponse.json({ notes });
}
