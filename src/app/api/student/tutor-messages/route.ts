import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";

/**
 * The private-tier student's own side of the 1:1 DM with their tutor.
 * Only meaningful once classType=private and a tutor is assigned — anyone
 * else gets an empty, "not available yet" shape rather than an error, since
 * the dashboard renders this panel unconditionally for a private student.
 */

export const dynamic = "force-dynamic";

async function loadStudent(userId: string) {
  return prisma.student.findUnique({
    where: { userId },
    select: { id: true, classType: true, tutorId: true },
  });
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await loadStudent(session.user.id as string);
  if (!student || student.classType !== "private" || !student.tutorId) {
    return NextResponse.json({ available: false, messages: [] });
  }

  const messages = await prisma.tutorMessage.findMany({
    where: { studentId: student.id, tutorId: student.tutorId },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  // Reading the thread is what "read" means here — no separate open/close event.
  await prisma.tutorMessage.updateMany({
    where: { studentId: student.id, tutorId: student.tutorId, senderId: { not: session.user.id as string }, readByStudentAt: null },
    data: { readByStudentAt: new Date() },
  });

  return NextResponse.json({
    available: true,
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      isMine: m.senderId === session.user!.id,
      createdAt: m.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await loadStudent(session.user.id as string);
  if (!student || student.classType !== "private" || !student.tutorId) {
    return NextResponse.json({ error: "No tutor assigned yet" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Message is empty" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "That message is too long" }, { status: 400 });

  const message = await prisma.tutorMessage.create({
    data: {
      studentId: student.id,
      tutorId: student.tutorId,
      senderId: session.user.id as string,
      body: text,
    },
  });

  const tutor = await prisma.lecturer.findUnique({ where: { id: student.tutorId }, select: { userId: true } });
  if (tutor?.userId) {
    void notify({
      to: { userIds: [tutor.userId] },
      title: "New message from your student",
      message: text.length > 140 ? `${text.slice(0, 140)}…` : text,
      link: "/lecturer/private-classes",
    }).catch((error) => console.error("tutor-messages notify failed:", error));
  }

  return NextResponse.json({ message: { id: message.id, body: message.body, isMine: true, createdAt: message.createdAt } }, { status: 201 });
}
