import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * Booking and editing one-to-one classes.
 *
 * Students on classType=private read these through /api/schedule, so a change
 * here lands on their calendar straight away — the same contract the group
 * timetable editor has.
 */

export const dynamic = "force-dynamic";

const STATUSES = ["scheduled", "completed", "cancelled", "postponed"];

type LecturerPrivateClassesAuth = { error: NextResponse } | { userId: string; role: string; lecturerId: string | null };

async function requireStaff(): Promise<LecturerPrivateClassesAuth> {
  const session = await requireAuthSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, lecturer: { select: { id: true } } },
  });

  const role = (user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return { error: NextResponse.json({ error: "Staff access required" }, { status: 403 }) };
  }

  return { userId: user!.id, role, lecturerId: user?.lecturer?.id ?? null };
}

/** GET — private students, and the classes booked for one of them. */
export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  try {
    const studentId = req.nextUrl.searchParams.get("studentId");

    const students = await prisma.student.findMany({
      where: { classType: "private", status: "active" },
      include: { user: { select: { name: true, email: true } }, branch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    const classes = studentId
      ? await prisma.privateClass.findMany({
          where: { studentId },
          include: {
            lecturer: { select: { user: { select: { name: true } } } },
            material: { select: { id: true, title: true } },
          },
          orderBy: { scheduledAt: "asc" },
        })
      : [];

    const [lecturers, materials] = await Promise.all([
      prisma.lecturer.findMany({
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
      })),
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
    const { studentId, scheduledAt, durationMinutes, topic, notes, lecturerId, materialId } = body;

    if (!studentId || !scheduledAt) {
      return NextResponse.json({ error: "studentId and scheduledAt are required" }, { status: 400 });
    }

    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: "scheduledAt is not a valid date" }, { status: 400 });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, classType: true },
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

    const duration = Number(durationMinutes);

    const created = await prisma.privateClass.create({
      data: {
        studentId,
        scheduledAt: when,
        durationMinutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 60,
        topic: typeof topic === "string" ? topic.trim() || null : null,
        notes: typeof notes === "string" ? notes.trim() || null : null,
        // Fall back to the signed-in tutor when none was picked.
        lecturerId: typeof lecturerId === "string" && lecturerId ? lecturerId : auth.lecturerId,
        materialId: typeof materialId === "string" && materialId ? materialId : null,
      },
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
    const { id, scheduledAt, durationMinutes, topic, notes, status, lecturerId, materialId } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (status && !STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
    }

    let when: Date | undefined;
    if (scheduledAt) {
      when = new Date(scheduledAt);
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json({ error: "scheduledAt is not a valid date" }, { status: 400 });
      }
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
      },
    });

    return NextResponse.json({ class: updated });
  } catch (error) {
    console.error("Private classes PUT failed:", error);
    return NextResponse.json({ error: "Unable to update this class" }, { status: 500 });
  }
}
