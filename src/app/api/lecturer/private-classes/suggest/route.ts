import { prisma } from "@/lib/prisma";
import { requireAiStaff } from "@/lib/ai-guard";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { suggestPrivateClassTimes } from "@/lib/ai";
import { normalizeSchedulePreferences } from "@/lib/private-schedule-preferences";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * "Suggest times" — fills candidate chips on the booking form from the
 * student's stated availability and the tutor's existing bookings. Proposes,
 * never books: the tutor or admin still picks a chip and presses the real
 * book button, same non-destructive contract as the announcement drafter.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAiStaff();
  if (!gate.ok) return gate.response;

  const limit = checkRateLimit(`private-class-suggest:${gate.userId}`, { windowMs: 60 * 60 * 1000, max: 20 });
  if (!limit.ok) return rateLimitResponse(limit, "You have asked for suggestions a lot in the last hour. Try again shortly.");

  try {
    const body = await req.json().catch(() => ({}));
    const studentId = typeof body.studentId === "string" ? body.studentId : "";
    const durationMinutes = Number(body.durationMinutes) || 60;
    if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });

    const [lecturer, student] = await Promise.all([
      prisma.lecturer.findUnique({ where: { userId: gate.userId }, select: { id: true } }),
      prisma.student.findUnique({
        where: { id: studentId },
        select: { id: true, classType: true, tutorId: true, admission: true, user: { select: { name: true } } },
      }),
    ]);
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    if (student.classType !== "private") return NextResponse.json({ error: "That student is not on a private class" }, { status: 400 });
    if (gate.role === "LECTURER" && student.tutorId !== lecturer?.id) {
      return NextResponse.json({ error: "That student is not assigned to you" }, { status: 403 });
    }

    const admission = student.admission && typeof student.admission === "object" && !Array.isArray(student.admission)
      ? (student.admission as Record<string, unknown>).privateSchedulePreferences
      : null;
    const preferences = normalizeSchedulePreferences(admission);

    const tutorId = gate.role === "LECTURER" ? lecturer?.id : student.tutorId;
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
    const busy = tutorId
      ? await prisma.privateClass.findMany({
          where: { lecturerId: tutorId, status: { notIn: ["cancelled", "declined"] }, scheduledAt: { gte: now, lt: windowEnd } },
          select: { scheduledAt: true },
        })
      : [];

    const result = await suggestPrivateClassTimes({
      studentName: student.user.name,
      dayRanges: preferences.dayRanges,
      durationMinutes,
      timezone: preferences.timezone,
      busyTimes: busy.map((b) => b.scheduledAt.toISOString()),
      now: now.toISOString(),
    });

    if (!result) {
      return NextResponse.json(
        { error: "The scheduling assistant is not available right now — book by hand for now." },
        { status: 503 },
      );
    }

    // The model was told about these conflicts; this is the check that
    // actually enforces it. A suggestion within 2 hours of an existing
    // booking, or in the past, never reaches the tutor.
    const busyMs = busy.map((b) => b.scheduledAt.getTime());
    const suggestions = result.suggestions.filter((s) => {
      const t = new Date(s.scheduledAt).getTime();
      if (t <= Date.now()) return false;
      return busyMs.every((b) => Math.abs(b - t) >= 2 * 3600 * 1000);
    });

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Private class suggest failed:", error);
    return NextResponse.json({ error: "Unable to suggest times" }, { status: 500 });
  }
}
