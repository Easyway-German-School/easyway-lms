import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { KIND, notify } from "@/lib/notify";
import { normalizeSchedulePreferences, parseSchedulePreferencesInput } from "@/lib/private-schedule-preferences";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Admin's view onto ONE private student's schedule.
 *
 * This exists because admin has no lecturer identity — the notification that
 * used to send admin to `/lecturer/private-classes` was sending them into a
 * portal they cannot use, and it read as a login bug. This is admin's own
 * page: view the student's preferences, edit them if needed, and tell the
 * tutor to look — never a booking screen. Booking/editing an actual session
 * still goes through `/api/lecturer/private-classes`, which already accepts
 * an admin session (see `requireStaff()` there) — this route only owns the
 * preferences half and the "notify the tutor" nudge, so there is exactly one
 * place that edits a booked session, not two that could drift apart.
 */

async function loadStudent(studentId: string) {
  return prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      classType: true,
      admission: true,
      level: true,
      studentCode: true,
      user: { select: { name: true, email: true } },
      branch: { select: { name: true } },
      tutor: { select: { id: true, userId: true, user: { select: { name: true } } } },
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const { studentId } = await params;
  const student = await loadStudent(studentId);
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (student.classType !== "private") return NextResponse.json({ error: "This student is not on a private class" }, { status: 400 });

  const admission = student.admission && typeof student.admission === "object" && !Array.isArray(student.admission)
    ? (student.admission as Record<string, unknown>)
    : {};
  const stored = admission.privateSchedulePreferences;

  return NextResponse.json({
    student: {
      id: student.id,
      name: student.user.name ?? "Unknown",
      email: student.user.email,
      level: student.level,
      studentCode: student.studentCode,
      branchName: student.branch?.name ?? null,
      tutorId: student.tutor?.id ?? null,
      tutorName: student.tutor?.user?.name ?? null,
    },
    submitted: Boolean(stored),
    preferences: stored ? normalizeSchedulePreferences(stored) : null,
  });
}

/** PATCH — admin overrides the student's own submitted preferences. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const { studentId } = await params;
  const student = await loadStudent(studentId);
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (student.classType !== "private") return NextResponse.json({ error: "This student is not on a private class" }, { status: 400 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const parsed = parseSchedulePreferencesInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const preferences = { ...parsed.preferences, submittedAt: new Date().toISOString(), updatedBy: "admin" as const };
  const admission = student.admission && typeof student.admission === "object" && !Array.isArray(student.admission)
    ? (student.admission as Record<string, unknown>)
    : {};
  await prisma.student.update({
    where: { id: student.id },
    data: { admission: { ...admission, privateSchedulePreferences: preferences } },
  });

  // The edit needs to show up on both sides — the whole point was that a
  // change made here should not sit invisible to the student or the tutor.
  const recipients = [student.tutor?.userId].filter((id): id is string => Boolean(id));
  if (recipients.length) {
    await notify({
      to: { userIds: recipients },
      kind: KIND.privateClassUpdated,
      severity: "info",
      title: "Private timetable preferences updated",
      message: `The office updated ${student.user.name ?? "a student"}'s preferred days and times.`,
      link: `/lecturer/private-classes?studentId=${encodeURIComponent(student.id)}`,
      dedupeKey: `private-schedule-preferences:${student.id}:${preferences.submittedAt}:tutor-from-admin`,
    });
  }
  await notify({
    to: { studentIds: [student.id] },
    kind: KIND.privateClassUpdated,
    severity: "info",
    title: "Private timetable preferences updated",
    message: "The office updated your preferred days and times for one-to-one classes.",
    link: "/calendar",
    dedupeKey: `private-schedule-preferences:${student.id}:${preferences.submittedAt}:student-from-admin`,
  });

  return NextResponse.json({ ok: true, preferences: parsed.preferences });
}

/** POST — "Notify tutor": a nudge, not a booking action. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const { studentId } = await params;
  const student = await loadStudent(studentId);
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (!student.tutor?.userId) {
    return NextResponse.json({ error: "This student has no tutor assigned yet" }, { status: 400 });
  }

  await notify({
    to: { userIds: [student.tutor.userId] },
    kind: KIND.privateClassUpdated,
    severity: "info",
    title: "Review this student's private timetable",
    message: `The office is flagging ${student.user.name ?? "a private student"}'s preferred days and times for you to look at.`,
    link: `/lecturer/private-classes?studentId=${encodeURIComponent(student.id)}`,
    dedupeKey: `private-schedule-notify-tutor:${student.id}:${Date.now()}`,
  });

  return NextResponse.json({ ok: true });
}
