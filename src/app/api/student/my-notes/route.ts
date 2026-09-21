import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** A generous ceiling, there only so a runaway client cannot fill the table. */
const MAX_NOTES_PER_STUDENT = 300;

/**
 * Start a new blank note — the "+" on My Notes.
 *
 * Creates the row up front (empty) and hands back its id, so the editor page
 * has a real place to autosave into from the first keystroke rather than
 * inventing an id client-side and racing its own first save.
 */
export async function POST() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, tenantId: true },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  // A blank note the student opened and walked away from is reused rather than
  // stacked up: tapping "+" twice must not leave two empty pages behind.
  const blank = await prisma.studentNote.findFirst({
    where: { studentId: student.id, title: "", content: "" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (blank) return NextResponse.json({ id: blank.id });

  const count = await prisma.studentNote.count({ where: { studentId: student.id } });
  if (count >= MAX_NOTES_PER_STUDENT) {
    return NextResponse.json(
      { error: "Your notebook is full — delete a note you no longer need first." },
      { status: 409 },
    );
  }

  const note = await prisma.studentNote.create({
    data: { studentId: student.id, tenantId: student.tenantId ?? null },
    select: { id: true },
  });

  return NextResponse.json({ id: note.id }, { status: 201 });
}
