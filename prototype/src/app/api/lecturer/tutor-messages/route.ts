import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { lecturerCan } from "@/lib/lecturer-features";

/**
 * The tutor's side of the 1:1 DM. Scoped to their OWN private students only —
 * a tutor reading another tutor's coaching thread is not a bug report anyone
 * wants to write, so this checks student.tutorId === the caller's lecturerId
 * rather than trusting the studentId in the query.
 */

export const dynamic = "force-dynamic";

type Auth = { error: NextResponse } | { userId: string; lecturerId: string };

async function requireTutor(): Promise<Auth> {
  const session = await requireAuthSession();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, lecturer: { select: { id: true, features: true } } },
  });

  if ((user?.role ?? "").toLowerCase() !== "lecturer" || !user?.lecturer) {
    return { error: NextResponse.json({ error: "Tutor access required" }, { status: 403 }) };
  }
  if (!lecturerCan(user.lecturer.features, "private_classes")) {
    return { error: NextResponse.json({ error: "The school has not given you private classes." }, { status: 403 }) };
  }

  return { userId: session.user.id as string, lecturerId: user.lecturer.id };
}

export async function GET(req: NextRequest) {
  const auth = await requireTutor();
  if ("error" in auth) return auth.error;

  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });

  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, tutorId: true } });
  if (!student || student.tutorId !== auth.lecturerId) {
    return NextResponse.json({ error: "Not your student" }, { status: 403 });
  }

  const messages = await prisma.tutorMessage.findMany({
    where: { studentId, tutorId: auth.lecturerId },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  await prisma.tutorMessage.updateMany({
    where: { studentId, tutorId: auth.lecturerId, senderId: { not: auth.userId }, readByTutorAt: null },
    data: { readByTutorAt: new Date() },
  });

  return NextResponse.json({
    messages: messages.map((m) => ({ id: m.id, body: m.body, isMine: m.senderId === auth.userId, createdAt: m.createdAt })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireTutor();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Message is empty" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "That message is too long" }, { status: 400 });

  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, tutorId: true, userId: true } });
  if (!student || student.tutorId !== auth.lecturerId) {
    return NextResponse.json({ error: "Not your student" }, { status: 403 });
  }

  const message = await prisma.tutorMessage.create({
    data: { studentId, tutorId: auth.lecturerId, senderId: auth.userId, body: text },
  });

  void notify({
    to: { userIds: [student.userId] },
    title: "Message from your tutor",
    message: text.length > 140 ? `${text.slice(0, 140)}…` : text,
    link: "/dashboard",
  }).catch((error) => console.error("tutor-messages notify failed:", error));

  return NextResponse.json({ message: { id: message.id, body: message.body, isMine: true, createdAt: message.createdAt } }, { status: 201 });
}
