import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { NextResponse } from "next/server";
import { normalizeSchedulePreferences, parseSchedulePreferencesInput } from "@/lib/private-schedule-preferences";

function readPreferences(admission: unknown) {
  if (!admission || typeof admission !== "object" || Array.isArray(admission)) return null;
  const value = (admission as Record<string, unknown>).privateSchedulePreferences;
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, classType: true, admission: true },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const stored = readPreferences(student.admission);
  return NextResponse.json({
    eligible: student.classType === "private",
    submitted: Boolean(stored),
    preferences: stored ? normalizeSchedulePreferences(stored) : null,
  });
}

export async function POST(req: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      classType: true,
      admission: true,
      tutor: { select: { userId: true, user: { select: { name: true } } } },
      user: { select: { name: true } },
    },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (student.classType !== "private") return NextResponse.json({ error: "This schedule is for private students only" }, { status: 400 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const parsed = parseSchedulePreferencesInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const preferences = { ...parsed.preferences, submittedAt: new Date().toISOString() };
  const admission = student.admission && typeof student.admission === "object" && !Array.isArray(student.admission)
    ? student.admission as Record<string, unknown>
    : {};
  await prisma.student.update({
    where: { id: student.id },
    data: { admission: { ...admission, privateSchedulePreferences: preferences } },
  });

  // Admin and the tutor each need a link that actually works FOR THEM: admin
  // has no lecturer identity to view the tutor's booking screen with, so it
  // gets its own review page instead of being sent into the lecturer portal.
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  const message = `${student.user.name ?? "A private student"} has shared preferred days and times for their one-to-one classes.`;
  if (admins.length > 0) {
    await notify({
      to: { userIds: admins.map((admin) => admin.id) },
      kind: KIND.privateClassUpdated,
      severity: "info",
      title: "Private timetable preferences received",
      message,
      link: `/admin/schedule/private/${encodeURIComponent(student.id)}`,
      dedupeKey: `private-schedule-preferences:${student.id}:${preferences.submittedAt}:admin`,
    });
  }
  if (student.tutor?.userId) {
    await notify({
      to: { userIds: [student.tutor.userId] },
      kind: KIND.privateClassUpdated,
      severity: "info",
      title: "Private timetable preferences received",
      message,
      link: `/lecturer/private-classes?studentId=${encodeURIComponent(student.id)}`,
      dedupeKey: `private-schedule-preferences:${student.id}:${preferences.submittedAt}:tutor`,
    });
  }

  return NextResponse.json({ ok: true, preferences });
}
