import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * A tutor telling their class something.
 *
 * Scoping is the whole point of this route. A tutor may only reach the cohort
 * they actually teach — their own branch, level and sitting, the same grouping
 * the roster and the attendance register use — plus anyone assigned to them as
 * a private student. The audience is resolved here from the tutor's own record
 * and never from the request body, so a crafted POST cannot broadcast to the
 * school.
 *
 * GET returns what they have sent, with how many have read it. That read count
 * is only meaningful because notify() fans a send out per recipient.
 */

type Audience = "cohort" | "student";

async function resolveLecturer(userId: string) {
  return prisma.lecturer.findUnique({
    where: { userId },
    include: { branch: { select: { id: true, name: true } } },
  });
}

/** Every student this tutor is allowed to address. */
async function reachableStudents(lecturer: {
  id: string;
  branchId: string | null;
  level: string | null;
  sessionSlot: string | null;
}) {
  const clauses = [];

  // The group cohort: branch + level + sitting.
  if (lecturer.branchId && lecturer.level) {
    clauses.push({
      branchId: lecturer.branchId,
      level: lecturer.level,
      ...(lecturer.sessionSlot ? { sessionSlot: lecturer.sessionSlot } : {}),
    });
  }

  // Private students follow the tutor, not the timetable.
  clauses.push({ tutorId: lecturer.id });

  return prisma.student.findMany({
    where: { status: "active", OR: clauses },
    select: {
      id: true,
      level: true,
      sessionSlot: true,
      classType: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { user: { name: "asc" } },
  });
}

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const lecturer = await resolveLecturer(session.user.id);
  if (!lecturer) return NextResponse.json({ error: "Lecturer profile not found" }, { status: 404 });

  const students = await reachableStudents(lecturer);

  const sent = await prisma.notification.findMany({
    where: { senderId: session.user.id, channel: { not: "email" } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { batchId: true, title: true, message: true, severity: true, createdAt: true, readAt: true },
  });

  // Fold the fanned-out rows back into one line per send.
  const byBatch = new Map<
    string,
    { batchId: string; title: string; message: string; severity: string; createdAt: string; sentTo: number; readBy: number }
  >();
  for (const row of sent) {
    const key = row.batchId ?? `${row.createdAt.toISOString()}-${row.title}`;
    const existing = byBatch.get(key);
    if (existing) {
      existing.sentTo += 1;
      if (row.readAt) existing.readBy += 1;
    } else {
      byBatch.set(key, {
        batchId: key,
        title: row.title,
        message: row.message,
        severity: row.severity,
        createdAt: row.createdAt.toISOString(),
        sentTo: 1,
        readBy: row.readAt ? 1 : 0,
      });
    }
  }

  return NextResponse.json({
    assigned: Boolean(lecturer.branchId && lecturer.level),
    cohortLabel:
      lecturer.branchId && lecturer.level
        ? `${lecturer.branch?.name ?? "Your branch"} · ${lecturer.level}${
            lecturer.sessionSlot ? ` · ${lecturer.sessionSlot}` : ""
          }`
        : null,
    students: students.map((s) => ({
      id: s.id,
      name: s.user.name ?? s.user.email,
      level: s.level,
      sessionSlot: s.sessionSlot,
      classType: s.classType,
    })),
    history: [...byBatch.values()],
  });
}

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as never)) as
    | { user?: { id?: string; name?: string } }
    | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const lecturer = await resolveLecturer(session.user.id);
  if (!lecturer) return NextResponse.json({ error: "Lecturer profile not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const audience: Audience = body.audience === "student" ? "student" : "cohort";
  const urgent = body.urgent === true;
  const studentIds = Array.isArray(body.studentIds)
    ? (body.studentIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];

  if (!title || !message) {
    return NextResponse.json({ error: "A title and a message are both required" }, { status: 400 });
  }
  if (title.length > 120) {
    return NextResponse.json({ error: "Keep the title under 120 characters" }, { status: 400 });
  }

  const reachable = await reachableStudents(lecturer);
  if (reachable.length === 0) {
    return NextResponse.json(
      { error: "You have no students yet. Set your branch, level and session under Customise my classes." },
      { status: 400 },
    );
  }

  // Whatever the body asked for, intersect it with what this tutor may reach.
  const allowed = new Set(reachable.map((s) => s.id));
  const targets =
    audience === "student" ? studentIds.filter((id) => allowed.has(id)) : reachable.map((s) => s.id);

  if (targets.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one student from your own class" },
      { status: 400 },
    );
  }

  const result = await notify({
    to: { studentIds: targets },
    kind: KIND.lecturerMessage,
    severity: urgent ? "warning" : "info",
    title,
    message,
    link: "/notifications",
    senderId: session.user.id,
    // Urgent already pushes by virtue of its severity; this makes the ordinary
    // case reach a phone too, which is the point of a class announcement.
    push: true,
  });

  return NextResponse.json({
    success: true,
    sentTo: result.created,
    pushed: result.pushed,
  });
}
