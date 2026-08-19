import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Read-only for a student — the tangible proof of what their 1:1 sessions
 * actually covered. Writing happens from the tutor's side only, at
 * /api/lecturer/session-notes.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    select: { id: true, classType: true },
  });
  if (!student || student.classType !== "private") {
    return NextResponse.json({ notes: [] });
  }

  const notes = await prisma.sessionNote.findMany({
    where: { studentId: student.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      tutor: { select: { user: { select: { name: true } } } },
      privateClass: { select: { scheduledAt: true, topic: true } },
    },
  });

  return NextResponse.json({
    notes: notes.map((n) => ({
      id: n.id,
      summary: n.summary,
      tutorName: n.tutor?.user?.name ?? "Your tutor",
      sessionTopic: n.privateClass?.topic ?? null,
      sessionDate: n.privateClass?.scheduledAt ?? null,
      createdAt: n.createdAt,
    })),
  });
}
