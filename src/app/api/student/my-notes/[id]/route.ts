import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_TITLE_CHARS = 120;
/** Same ceiling as a note written under a recording — see /api/student/videos/[id]/my-notes. */
const MAX_CONTENT_CHARS = 20_000;

/**
 * One of a student's own free-form notes. Every method looks the note up by BOTH
 * its id and the signed-in student, so another student's note id is simply "not
 * found" — never a 403 that confirms the id exists.
 */
async function ownNote(id: string, userId: string) {
  const student = await prisma.student.findUnique({ where: { userId }, select: { id: true } });
  if (!student) return null;
  return prisma.studentNote.findFirst({ where: { id, studentId: student.id } });
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const note = await ownNote(id, session.user.id);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ id: note.id, title: note.title, content: note.content, updatedAt: note.updatedAt });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const note = await ownNote(id, session.user.id);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const data: { title?: string; content?: string } = {};

  if (typeof body.title === "string") data.title = body.title.trim().slice(0, MAX_TITLE_CHARS);
  if (typeof body.content === "string") {
    if (body.content.length > MAX_CONTENT_CHARS) {
      return NextResponse.json({ error: "That note is too long — split it into two." }, { status: 400 });
    }
    data.content = body.content;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });

  const saved = await prisma.studentNote.update({ where: { id: note.id }, data, select: { updatedAt: true } });
  return NextResponse.json({ ok: true, updatedAt: saved.updatedAt });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const note = await ownNote(id, session.user.id);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.studentNote.delete({ where: { id: note.id } });
  return NextResponse.json({ ok: true });
}
