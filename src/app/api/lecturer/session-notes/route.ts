import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { lecturerCan } from "@/lib/lecturer-features";

/**
 * The tutor's write-up after a private session — what makes the 1:1 tangible
 * to the student instead of just a slot on a calendar. Same ownership check
 * as tutor-messages: a tutor may only write about their OWN private student.
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

  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { tutorId: true } });
  if (!student || student.tutorId !== auth.lecturerId) {
    return NextResponse.json({ error: "Not your student" }, { status: 403 });
  }

  const notes = await prisma.sessionNote.findMany({
    where: { studentId, tutorId: auth.lecturerId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { privateClass: { select: { scheduledAt: true, topic: true } } },
  });

  return NextResponse.json({
    notes: notes.map((n) => ({
      id: n.id,
      summary: n.summary,
      sessionTopic: n.privateClass?.topic ?? null,
      sessionDate: n.privateClass?.scheduledAt ?? null,
      createdAt: n.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireTutor();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const privateClassId = typeof body.privateClassId === "string" && body.privateClassId ? body.privateClassId : null;

  if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  if (!summary) return NextResponse.json({ error: "Write something for the student to read" }, { status: 400 });
  if (summary.length > 4000) return NextResponse.json({ error: "That note is too long" }, { status: 400 });

  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { tutorId: true, userId: true } });
  if (!student || student.tutorId !== auth.lecturerId) {
    return NextResponse.json({ error: "Not your student" }, { status: 403 });
  }

  if (privateClassId) {
    const cls = await prisma.privateClass.findUnique({ where: { id: privateClassId }, select: { studentId: true } });
    if (!cls || cls.studentId !== studentId) {
      return NextResponse.json({ error: "That session doesn't belong to this student" }, { status: 400 });
    }
  }

  const note = await prisma.sessionNote.create({
    data: { studentId, tutorId: auth.lecturerId, summary, privateClassId },
  });

  void notify({
    to: { userIds: [student.userId] },
    title: "Your tutor added session notes",
    message: summary.length > 140 ? `${summary.slice(0, 140)}…` : summary,
    link: "/dashboard",
  }).catch((error) => console.error("session-notes notify failed:", error));

  return NextResponse.json({ note }, { status: 201 });
}
