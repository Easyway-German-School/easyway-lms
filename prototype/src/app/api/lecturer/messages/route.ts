import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  isAssigned,
  readAssignment,
  studentWhereForAssignment,
  type AssignmentSource,
} from "@/lib/lecturer-assignment";

export const dynamic = "force-dynamic";

type LecturerMessagesAuth = { error: NextResponse } | { lecturer: { id: string; status: string; branchId: string | null; level: string | null; sessionSlot: string | null; user: { name: string | null; email: string } } };

/**
 * Announcements from a tutor to the cohort they teach.
 *
 * Built on the existing Notification table rather than a new Message model.
 * Students already have a notifications page and a bell in the shell, so a
 * separate inbox would mean two places to check — and the one thing worse than
 * no messaging is messaging nobody notices.
 *
 * One row per recipient. That costs more rows than a single broadcast row, but
 * it means read state, and later deletion, work per student without any
 * special-casing.
 */

async function requireLecturer(): Promise<LecturerMessagesAuth> {
  const session = await requireAuthSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const lecturer = await prisma.lecturer.findUnique({
    where: { userId: session.user.id },
    include: { user: { select: { name: true, email: true } }, branch: { select: { id: true, name: true } } },
  });

  if (!lecturer) {
    return { error: NextResponse.json({ error: "Lecturer profile not found" }, { status: 404 }) };
  }

  return { lecturer };
}

/**
 * Everyone this tutor teaches.
 *
 * READ THROUGH THE SHARED HELPER, like the roster, attendance, grading and the
 * timetable already do. This route was the last one still on the old model —
 * one branch, one level, one sitting, read straight off the Lecturer row — and
 * that model was replaced precisely because it cannot describe a real tutor. A
 * tutor who takes A1 and A2 at Lagos and Port Harcourt has one branchId and one
 * level on their record, so this query reached exactly one of their four
 * classes and silently dropped the rest.
 *
 * The effect was quiet and bad: a tutor sends "no class on Thursday", it goes
 * to a quarter of the people it was meant for, and the other three quarters
 * turn up to a locked room. Nothing errored, so nobody would have found it
 * until somebody complained.
 */
async function cohortStudents(lecturer: AssignmentSource) {
  const assignment = readAssignment(lecturer);
  const where = studentWhereForAssignment(assignment);
  if (!where || !isAssigned(assignment)) return [];

  return prisma.student.findMany({
    where: { ...(where as Record<string, unknown>), status: "active" } as never,
    select: { id: true, user: { select: { name: true, email: true } } },
  });
}

/** GET — what this tutor has already sent, newest first, grouped per send. */
export async function GET() {
  const auth = await requireLecturer();
  if ("error" in auth) return auth.error;
  const { lecturer } = auth;

  const students = await cohortStudents(lecturer);
  const studentIds = students.map((student) => student.id);

  const notifications = studentIds.length
    ? await prisma.notification.findMany({
        where: { studentId: { in: studentIds }, channel: "in-app" },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: {
          id: true,
          title: true,
          message: true,
          level: true,
          createdAt: true,
          readAt: true,
          studentId: true,
        },
      })
    : [];

  // Rows written in the same second with the same title are one announcement.
  // Grouping in the read path keeps the write path a plain createMany.
  const grouped = new Map<
    string,
    { key: string; title: string; message: string; sentAt: Date; recipients: number; readCount: number }
  >();

  for (const notification of notifications) {
    const key = `${notification.title}|${Math.floor(notification.createdAt.getTime() / 1000)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.recipients += 1;
      if (notification.readAt) existing.readCount += 1;
    } else {
      grouped.set(key, {
        key,
        title: notification.title,
        message: notification.message,
        sentAt: notification.createdAt,
        recipients: 1,
        readCount: notification.readAt ? 1 : 0,
      });
    }
  }

  return NextResponse.json({
    sent: Array.from(grouped.values()),
    cohortSize: students.length,
    recipients: students.map((student) => ({
      id: student.id,
      name: student.user.name || student.user.email,
      email: student.user.email,
    })),
    assigned: Boolean(lecturer.branchId && lecturer.level),
  });
}

/** POST — send to the whole cohort, or to one student. */
export async function POST(request: NextRequest) {
  const auth = await requireLecturer();
  if ("error" in auth) return auth.error;
  const { lecturer } = auth;

  try {
    const body = await request.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";

    if (!title || !message) {
      return NextResponse.json({ error: "A subject and a message are both required" }, { status: 400 });
    }

    const students = await cohortStudents(lecturer);
    if (students.length === 0) {
      return NextResponse.json(
        { error: "You have no cohort yet. Set your branch and level under Customise my classes first." },
        { status: 400 },
      );
    }

    // Sending to one student is still restricted to the tutor's own cohort —
    // a tutor should not be able to message the whole school by guessing ids.
    const targets = studentId ? students.filter((student) => student.id === studentId) : students;
    if (targets.length === 0) {
      return NextResponse.json({ error: "That student is not in your class" }, { status: 403 });
    }

    const sentAt = new Date();
    await prisma.notification.createMany({
      data: targets.map((student) => ({
        title,
        // The student sees who it is from. Without this an announcement reads
        // as coming from "the system", which nobody replies to.
        message: `${message}\n\n— ${lecturer.user.name || "Your tutor"}`,
        channel: "in-app",
        studentId: student.id,
        branchId: lecturer.branchId,
        level: lecturer.level,
        status: "sent",
        sentAt,
      })),
    });

    return NextResponse.json({ ok: true, recipients: targets.length });
  } catch (error) {
    console.error("Lecturer message send failed", error);
    return NextResponse.json({ error: "Could not send your message" }, { status: 500 });
  }
}
