import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET — this student's own upcoming private sessions, for the "request a change" list. */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, classType: true, deliveryMode: true },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (student.classType !== "private") return NextResponse.json({ classes: [] });

  const classes = await prisma.privateClass.findMany({
    where: {
      studentId: student.id,
      status: { notIn: ["cancelled", "declined", "skipped"] },
      scheduledAt: { gte: new Date() },
    },
    include: { lecturer: { select: { user: { select: { name: true } } } } },
    orderBy: { scheduledAt: "asc" },
    take: 20,
  });

  return NextResponse.json({
    classes: classes.map((c) => ({
      id: c.id,
      scheduledAt: c.scheduledAt,
      durationMinutes: c.durationMinutes,
      topic: c.topic,
      status: c.status,
      proposedAt: c.proposedAt,
      lecturerName: c.lecturer?.user?.name ?? null,
      deliveryMode: c.deliveryMode ?? student.deliveryMode,
    })),
  });
}

export async function POST(req: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, classType: true, tutorId: true, user: { select: { name: true } }, tutor: { select: { userId: true } } },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (student.classType !== "private") return NextResponse.json({ error: "Private students only" }, { status: 400 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const scheduledAt = typeof body?.scheduledAt === "string" ? new Date(body.scheduledAt) : new Date("invalid");
  const duration = Number(body?.durationMinutes ?? 60);
  if (Number.isNaN(scheduledAt.getTime()) || !Number.isFinite(duration) || duration < 15 || duration > 240) {
    return NextResponse.json({ error: "Choose a valid date and duration" }, { status: 400 });
  }
  const end = new Date(scheduledAt.getTime() + Math.round(duration) * 60_000);
  const conflict = await prisma.privateClass.findFirst({
    where: { studentId: student.id, status: { notIn: ["cancelled", "declined"] }, scheduledAt: { lt: end, gte: new Date(scheduledAt.getTime() - 240 * 60_000) } },
    select: { id: true },
  });
  if (conflict) return NextResponse.json({ error: "You already have a private session around that time" }, { status: 409 });
  const created = await prisma.privateClass.create({
    data: { studentId: student.id, scheduledAt, durationMinutes: Math.round(duration), topic: typeof body?.topic === "string" ? body.topic.trim() || null : null, status: "requested", notes: typeof body?.notes === "string" ? body.notes.trim() || null : null, lecturerId: student.tutorId },
  });
  // Admin gets its own review link — it has no lecturer identity to view the
  // tutor's booking screen with, so sending it there is a dead end.
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  const message = `${student.user.name ?? "A student"} requested ${scheduledAt.toLocaleString()} for a private session.`;
  if (admins.length) {
    await notify({ to: { userIds: admins.map((admin) => admin.id) }, kind: KIND.privateClassUpdated, severity: "info", title: "Private session request", message, link: `/admin/schedule/private/${encodeURIComponent(student.id)}`, dedupeKey: `private-request:${created.id}:admin` });
  }
  if (student.tutor?.userId) {
    await notify({ to: { userIds: [student.tutor.userId] }, kind: KIND.privateClassUpdated, severity: "info", title: "Private session request", message, link: `/lecturer/private-classes?studentId=${encodeURIComponent(student.id)}`, dedupeKey: `private-request:${created.id}:tutor` });
  }
  return NextResponse.json({ class: created }, { status: 201 });
}