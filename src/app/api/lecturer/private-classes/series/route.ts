import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "../route";
import { createSeries, endSeries } from "@/lib/private-class-series";
import { SCHEDULE_DAYS, type ScheduleDay } from "@/lib/private-schedule-preferences";
import { KIND, notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** POST — turn a booking into a standing weekly (or twice-weekly) pattern. */
export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const { studentId, weekdays, startTime, durationMinutes, deliveryMode, location, topic, materialId, timezone, lecturerId, startDate, endDate } = body;

    if (!studentId || !Array.isArray(weekdays) || weekdays.length === 0) {
      return NextResponse.json({ error: "studentId and at least one weekday are required" }, { status: 400 });
    }
    const cleanWeekdays = weekdays.filter((d): d is ScheduleDay => typeof d === "string" && (SCHEDULE_DAYS as readonly string[]).includes(d));
    if (cleanWeekdays.length === 0) {
      return NextResponse.json({ error: "No valid weekdays given" }, { status: 400 });
    }
    if (typeof startTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
      return NextResponse.json({ error: "startTime must be HH:mm" }, { status: 400 });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, classType: true, tutorId: true, userId: true, user: { select: { name: true } }, tenantId: true },
    });
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    if (student.classType !== "private") {
      return NextResponse.json({ error: "That student is on a group class. Switch them to private first." }, { status: 400 });
    }
    if (auth.role === "lecturer" && student.tutorId !== auth.lecturerId) {
      return NextResponse.json({ error: "That student is not assigned to you" }, { status: 403 });
    }

    const duration = Number(durationMinutes);
    const start = startDate ? new Date(startDate) : new Date();
    if (Number.isNaN(start.getTime())) return NextResponse.json({ error: "startDate is not a valid date" }, { status: 400 });
    const end = typeof endDate === "string" && endDate ? new Date(endDate) : null;
    if (end && Number.isNaN(end.getTime())) return NextResponse.json({ error: "endDate is not a valid date" }, { status: 400 });

    const { series, created } = await createSeries({
      studentId,
      lecturerId: auth.role === "lecturer" ? auth.lecturerId : (typeof lecturerId === "string" && lecturerId ? lecturerId : auth.lecturerId),
      weekdays: cleanWeekdays,
      startTime,
      durationMinutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 60,
      deliveryMode: typeof deliveryMode === "string" ? deliveryMode || null : null,
      location: typeof location === "string" ? location.trim() || null : null,
      topic: typeof topic === "string" ? topic.trim() || null : null,
      materialId: typeof materialId === "string" && materialId ? materialId : null,
      timezone: typeof timezone === "string" && timezone.trim() ? timezone.trim() : "UTC",
      startDate: start,
      endDate: end,
      createdBy: auth.role === "admin" ? "admin" : "tutor",
      tenantId: student.tenantId,
    });

    await notify({
      to: { userIds: [student.userId] },
      kind: KIND.privateClassUpdated,
      severity: "info",
      title: "Recurring private classes set up",
      message: `${cleanWeekdays.join(", ")} at ${startTime}, starting ${start.toLocaleDateString()}.`,
      link: "/calendar",
      dedupeKey: `private-series:${series.id}:created`,
    });

    return NextResponse.json({ series, occurrencesCreated: created }, { status: 201 });
  } catch (error) {
    console.error("Private class series POST failed:", error);
    return NextResponse.json({ error: "Unable to set up this series" }, { status: 500 });
  }
}

/** PATCH — end a series. Occurrences already booked are left alone; cancel those individually if needed. */
export async function PATCH(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const seriesId = typeof body?.seriesId === "string" ? body.seriesId : "";
    if (!seriesId) return NextResponse.json({ error: "seriesId is required" }, { status: 400 });

    const series = await prisma.privateClassSeries.findUnique({
      where: { id: seriesId },
      include: { student: { select: { userId: true, tutorId: true } } },
    });
    if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 });
    if (auth.role === "lecturer" && series.lecturerId !== auth.lecturerId && series.student.tutorId !== auth.lecturerId) {
      return NextResponse.json({ error: "That series is not assigned to you" }, { status: 403 });
    }

    const ended = await endSeries(seriesId);
    await notify({
      to: { userIds: [series.student.userId] },
      kind: KIND.privateClassUpdated,
      severity: "info",
      title: "Recurring private classes ended",
      message: "Your standing weekly booking has been stopped. Sessions already on your calendar are unaffected.",
      link: "/calendar",
      dedupeKey: `private-series:${seriesId}:ended`,
    });

    return NextResponse.json({ series: ended });
  } catch (error) {
    console.error("Private class series PATCH failed:", error);
    return NextResponse.json({ error: "Unable to end this series" }, { status: 500 });
  }
}
