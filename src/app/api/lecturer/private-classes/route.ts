import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { lecturerCan } from "@/lib/lecturer-features";
import { KIND, notify } from "@/lib/notify";
import { topUpSeriesForStudent } from "@/lib/private-class-series";
import { ensureAttendanceComputed } from "@/lib/private-classes";

/**
 * Booking and editing one-to-one classes.
 *
 * Students on classType=private read these through /api/schedule, so a change
 * here lands on their calendar straight away — the same contract the group
 * timetable editor has.
 */

export const dynamic = "force-dynamic";

const STATUSES = ["requested", "scheduled", "completed", "cancelled", "postponed", "declined", "cancel_requested", "reschedule_requested"];
const DELIVERY_MODES = ["physical", "online", "hybrid"];
const ATTENDANCE_STATUSES = ["present", "absent", "late", "no_show"];

export type LecturerPrivateClassesAuth = { error: NextResponse } | { userId: string; role: string; lecturerId: string | null };

/** Exported for `./series/route.ts` — one auth check for every private-class write, booking a single session or a whole series. */
export async function requireStaff(): Promise<LecturerPrivateClassesAuth> {
  const session = await requireAuthSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, lecturer: { select: { id: true, features: true } } },
  });

  const role = (user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return { error: NextResponse.json({ error: "Staff access required" }, { status: 403 }) };
  }

  /**
   * A tutor the school has not put on private tuition does not get this list,
   * whichever way they arrive at it. Admins are exempt — this toggle is about
   * how the teaching staff is organised, not about who may audit it.
   */
  if (role === "lecturer" && user?.lecturer && !lecturerCan(user.lecturer.features, "private_classes")) {
    return {
      error: NextResponse.json(
        {
          error: "Not your area",
          message: "The school has not given you private classes. Ask the office if this is wrong.",
        },
        { status: 403 },
      ),
    };
  }

  return { userId: user!.id, role, lecturerId: user?.lecturer?.id ?? null };
}

/** GET — private students, and the classes booked for one of them. */
export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  try {
    const studentId = req.nextUrl.searchParams.get("studentId");
    if (studentId) await topUpSeriesForStudent(studentId);

    const students = await prisma.student.findMany({
      where: {
        classType: "private",
        status: "active",
        ...(auth.role === "lecturer" && auth.lecturerId ? { tutorId: auth.lecturerId } : {}),
      },
      include: { user: { select: { name: true, email: true } }, branch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    const preferencesFor = (admission: unknown) => {
      if (!admission || typeof admission !== "object" || Array.isArray(admission)) return null;
      const preferences = (admission as Record<string, unknown>).privateSchedulePreferences;
      return preferences && typeof preferences === "object" && !Array.isArray(preferences) ? preferences : null;
    };

    const classes = studentId
      ? await prisma.privateClass.findMany({
          where: {
            studentId,
            ...(auth.role === "lecturer" && auth.lecturerId ? { lecturerId: auth.lecturerId } : {}),
          },
          include: {
            lecturer: { select: { user: { select: { name: true } } } },
            material: { select: { id: true, title: true } },
          },
          orderBy: { scheduledAt: "asc" },
        })
      : [];

    // Fills in attendance for any past online/hybrid session nobody has
    // marked yet — see `ensureAttendanceComputed`. Cheap in the common case:
    // most rows already have a value and short-circuit immediately.
    if (classes.length > 0) {
      const studentDeliveryMode = (await prisma.student.findUnique({ where: { id: studentId! }, select: { deliveryMode: true } }))?.deliveryMode ?? "physical";
      await Promise.all(
        classes.map(async (c) => {
          const computed = await ensureAttendanceComputed(c, studentDeliveryMode);
          if (computed) c.attendanceStatus = computed;
        }),
      );
    }

    const [lecturers, materials] = await Promise.all([
      prisma.lecturer.findMany({
        where: auth.role === "lecturer" && auth.lecturerId ? { id: auth.lecturerId } : undefined,
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.material.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true } }),
    ]);

    return NextResponse.json({
      students: students.map((s) => ({
        id: s.id,
        name: s.user.name ?? "Unknown",
        email: s.user.email,
        level: s.level,
        studentCode: s.studentCode,
        branchName: s.branch?.name ?? null,
        schedulePreferences: preferencesFor(s.admission),
      })),
      classes: classes.map((c) => ({
        id: c.id,
        scheduledAt: c.scheduledAt,
        durationMinutes: c.durationMinutes,
        topic: c.topic,
        status: c.status,
        notes: c.notes,
        lecturerName: c.lecturer?.user?.name ?? null,
        lecturerId: c.lecturerId,
        materialId: c.materialId,
        materialTitle: c.material?.title ?? null,
        seriesId: c.seriesId,
        isException: c.isException,
        deliveryMode: c.deliveryMode,
        location: c.location,
        proposedAt: c.proposedAt,
        attendanceStatus: c.attendanceStatus,
        attendanceNote: c.attendanceNote,
      })),
      currentLecturerId: auth.lecturerId,
      canAssignTutor: auth.role === "admin",
      lecturers: lecturers.map((l) => ({ id: l.id, name: l.user.name ?? "Unnamed tutor" })),
      materials,
      statuses: STATUSES,
    });
  } catch (error) {
    console.error("Private classes GET failed:", error);
    return NextResponse.json({ error: "Unable to load private classes" }, { status: 500 });
  }
}

/** POST — book a new one-to-one class. */
export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const { studentId, scheduledAt, durationMinutes, topic, notes, lecturerId, materialId, deliveryMode, location } = body;

    if (typeof deliveryMode === "string" && deliveryMode && !DELIVERY_MODES.includes(deliveryMode)) {
      return NextResponse.json({ error: `deliveryMode must be one of ${DELIVERY_MODES.join(", ")}` }, { status: 400 });
    }
    if (!studentId || !scheduledAt) {
      return NextResponse.json({ error: "studentId and scheduledAt are required" }, { status: 400 });
    }

    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: "scheduledAt is not a valid date" }, { status: 400 });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, classType: true, tutorId: true, userId: true, user: { select: { name: true } } },
    });
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    if (student.classType !== "private") {
      return NextResponse.json(
        { error: "That student is on a group class. Switch them to private first." },
        { status: 400 },
      );
    }
    if (auth.role === "lecturer" && student.tutorId !== auth.lecturerId) {
      return NextResponse.json({ error: "That student is not assigned to you" }, { status: 403 });
    }

    const duration = Number(durationMinutes);

    const end = new Date(when.getTime() + (Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 60) * 60_000);
    const overlap = await prisma.privateClass.findFirst({
      where: { lecturerId: auth.role === "lecturer" ? auth.lecturerId : (typeof lecturerId === "string" && lecturerId ? lecturerId : auth.lecturerId), status: { notIn: ["cancelled", "declined"] }, scheduledAt: { lt: end, gte: new Date(when.getTime() - 240 * 60_000) } },
      select: { id: true },
    });
    if (overlap) return NextResponse.json({ error: "That tutor already has a private session around this time" }, { status: 409 });

    const created = await prisma.privateClass.create({
      data: {
        studentId,
        scheduledAt: when,
        durationMinutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 60,
        topic: typeof topic === "string" ? topic.trim() || null : null,
        notes: typeof notes === "string" ? notes.trim() || null : null,
        // Fall back to the signed-in tutor when none was picked.
        lecturerId: auth.role === "lecturer"
          ? auth.lecturerId
          : typeof lecturerId === "string" && lecturerId ? lecturerId : auth.lecturerId,
        materialId: typeof materialId === "string" && materialId ? materialId : null,
        deliveryMode: typeof deliveryMode === "string" && deliveryMode ? deliveryMode : null,
        location: typeof location === "string" ? location.trim() || null : null,
      },
    });

    await notify({
      to: { userIds: [student.userId] },
      kind: KIND.privateClassUpdated,
      severity: "info",
      title: "Private class booked",
      message: `${created.scheduledAt.toLocaleString()}${created.topic ? ` · ${created.topic}` : ""}`,
      link: "/calendar",
      dedupeKey: `private-class:${created.id}:booked`,
    });

    return NextResponse.json({ class: created }, { status: 201 });
  } catch (error) {
    console.error("Private classes POST failed:", error);
    return NextResponse.json({ error: "Unable to book this class" }, { status: 500 });
  }
}

/** PUT — update or cancel an existing one-to-one class. */
export async function PUT(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const { id, scheduledAt, durationMinutes, topic, notes, status, lecturerId, materialId, deliveryMode, location, action, attendanceStatus, attendanceNote } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (status && !STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
    }
    if (typeof deliveryMode === "string" && deliveryMode && !DELIVERY_MODES.includes(deliveryMode)) {
      return NextResponse.json({ error: `deliveryMode must be one of ${DELIVERY_MODES.join(", ")}` }, { status: 400 });
    }
    if (typeof attendanceStatus === "string" && attendanceStatus && !ATTENDANCE_STATUSES.includes(attendanceStatus)) {
      return NextResponse.json({ error: `attendanceStatus must be one of ${ATTENDANCE_STATUSES.join(", ")}` }, { status: 400 });
    }

    let when: Date | undefined;
    if (scheduledAt) {
      when = new Date(scheduledAt);
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json({ error: "scheduledAt is not a valid date" }, { status: 400 });
      }
    }

    const existing = await prisma.privateClass.findUnique({
      where: { id: String(id) },
      include: { student: { select: { id: true, userId: true, tutorId: true } }, lecturer: { select: { userId: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Class not found" }, { status: 404 });
    if (auth.role === "lecturer" && existing.lecturerId !== auth.lecturerId && existing.student.tutorId !== auth.lecturerId) {
      return NextResponse.json({ error: "That class is not assigned to you" }, { status: 403 });
    }
    if (auth.role === "lecturer" && typeof lecturerId === "string" && lecturerId !== auth.lecturerId) {
      return NextResponse.json({ error: "Only an admin can change the assigned tutor" }, { status: 403 });
    }

    // Approving/declining a student's cancel or reschedule request is its own
    // small state machine, not a generic field update — approving a
    // reschedule has to MOVE `scheduledAt` to what the student proposed, and
    // both actions have to clear `proposedAt` either way. Handled here,
    // before the generic update, so the two paths can't be conflated.
    if (action === "approve_request" || action === "decline_request") {
      if (existing.status !== "cancel_requested" && existing.status !== "reschedule_requested") {
        return NextResponse.json({ error: "There is no pending request on this session" }, { status: 400 });
      }
      const approve = action === "approve_request";
      const isReschedule = existing.status === "reschedule_requested";
      const updated = await prisma.privateClass.update({
        where: { id: String(id) },
        data: {
          status: approve ? (isReschedule ? "scheduled" : "cancelled") : "scheduled",
          scheduledAt: approve && isReschedule && existing.proposedAt ? existing.proposedAt : undefined,
          proposedAt: null,
        },
      });
      const title = approve
        ? isReschedule ? "Reschedule approved" : "Cancellation approved"
        : isReschedule ? "Reschedule request declined" : "Cancellation request declined";
      await notify({
        to: { userIds: [existing.student.userId] },
        kind: KIND.privateClassUpdated,
        severity: approve && !isReschedule ? "warning" : "info",
        title,
        message: approve
          ? isReschedule
            ? `Your session is now ${updated.scheduledAt.toLocaleString()}.`
            : "Your session has been cancelled as requested."
          : "Your request was not approved — the original booking stands. Message your tutor if you need another option.",
        link: "/calendar",
        dedupeKey: `private-class:${updated.id}:${action}:${updated.updatedAt.toISOString()}`,
      });
      return NextResponse.json({ class: updated });
    }

    const duration = Number(durationMinutes);

    const updated = await prisma.privateClass.update({
      where: { id },
      data: {
        scheduledAt: when,
        durationMinutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined,
        topic: typeof topic === "string" ? topic.trim() || null : undefined,
        notes: typeof notes === "string" ? notes.trim() || null : undefined,
        status: status ?? undefined,
        lecturerId: typeof lecturerId === "string" ? lecturerId || null : undefined,
        materialId: materialId === null ? null : typeof materialId === "string" && materialId ? materialId : undefined,
        deliveryMode: deliveryMode === null ? null : typeof deliveryMode === "string" && deliveryMode ? deliveryMode : undefined,
        location: typeof location === "string" ? location.trim() || null : undefined,
        attendanceStatus: attendanceStatus === null ? null : typeof attendanceStatus === "string" && attendanceStatus ? attendanceStatus : undefined,
        attendanceNote: typeof attendanceNote === "string" ? attendanceNote.trim() || null : undefined,
        // A direct edit to a series-generated row takes it off the pattern:
        // the next generation pass must never touch this date again, and
        // ending or regenerating the series must never overwrite it.
        isException: existing.seriesId ? true : undefined,
      },
    });

    const event = status === "scheduled" && existing.status === "requested"
      ? "Private session request accepted"
      : status === "declined"
        ? "Private session request declined"
        : status === "cancelled"
      ? "Private class cancelled"
      : status === "postponed"
        ? "Private class postponed"
        : scheduledAt
          ? "Private class rescheduled"
          : "Private class updated";
    await notify({
      to: { userIds: [existing.student.userId] },
      kind: KIND.privateClassUpdated,
      severity: status === "cancelled" ? "warning" : "info",
      title: event,
      message: status === "cancelled"
        ? "This booking is no longer scheduled. Open your calendar for the latest details."
        : `${updated.scheduledAt.toLocaleString()}${updated.topic ? ` · ${updated.topic}` : ""}`,
      link: "/calendar",
      dedupeKey: `private-class:${updated.id}:${updated.updatedAt.toISOString()}`,
    });
    const staffRecipients = [existing.lecturer?.userId, updated.lecturerId && updated.lecturerId !== existing.lecturerId ? (await prisma.lecturer.findUnique({ where: { id: updated.lecturerId }, select: { userId: true } }))?.userId : null].filter((id): id is string => Boolean(id));
    if (staffRecipients.length) {
      await notify({ to: { userIds: staffRecipients }, kind: KIND.privateClassUpdated, severity: "info", title: event, message: `${updated.scheduledAt.toLocaleString()}${updated.topic ? ` · ${updated.topic}` : ""}`, link: `/lecturer/private-classes?studentId=${encodeURIComponent(existing.student.id)}`, dedupeKey: `private-class-staff:${updated.id}:${updated.updatedAt.toISOString()}` }).catch(() => {});
    }

    return NextResponse.json({ class: updated });
  } catch (error) {
    console.error("Private classes PUT failed:", error);
    return NextResponse.json({ error: "Unable to update this class" }, { status: 500 });
  }
}

/** DELETE — remove a booking before it starts and notify the student. */
export async function DELETE(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const existing = await prisma.privateClass.findUnique({
      where: { id },
      include: { student: { select: { userId: true, tutorId: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Class not found" }, { status: 404 });
    if (auth.role === "lecturer" && existing.lecturerId !== auth.lecturerId && existing.student.tutorId !== auth.lecturerId) {
      return NextResponse.json({ error: "That class is not assigned to you" }, { status: 403 });
    }

    await prisma.privateClass.delete({ where: { id } });
    await notify({
      to: { userIds: [existing.student.userId] },
      kind: KIND.privateClassUpdated,
      severity: "warning",
      title: "Private class removed",
      message: "A private class booking was removed from your calendar.",
      link: "/calendar",
      dedupeKey: `private-class:${id}:removed:${existing.updatedAt.toISOString()}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Private classes DELETE failed:", error);
    return NextResponse.json({ error: "Unable to remove this class" }, { status: 500 });
  }
}
