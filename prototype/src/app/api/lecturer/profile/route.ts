import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcryptjs from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LEVELS } from "@/lib/levels";
import { cohortRoomName, roomDisplayName } from "@/lib/live-classroom";

export const dynamic = "force-dynamic";

const SLOTS = ["morning", "afternoon", "evening"] as const;

async function requireLecturer() {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const lecturer = await prisma.lecturer.findUnique({
    where: { userId: session.user.id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      branch: { select: { id: true, name: true, mode: true } },
    },
  });

  if (!lecturer) {
    return { error: NextResponse.json({ error: "Lecturer profile not found" }, { status: 404 }) };
  }

  return { lecturer };
}

/**
 * A tutor's own record, the cohort they teach, and that cohort's roster.
 *
 * One request rather than three, because /lecturer/classes and
 * /lecturer/settings both need the whole picture and the tutor portal was
 * already slow enough with a fetch per card.
 */
export async function GET() {
  const auth = await requireLecturer();
  if (auth.error) return auth.error;
  const { lecturer } = auth;

  // The cohort is branch + level + slot. That is how the school actually
  // groups people, and it is what the timetable, the community space and the
  // live room are all keyed on — deriving the roster the same way keeps them
  // agreeing with each other.
  const roster = lecturer.branchId && lecturer.level
    ? await prisma.student.findMany({
        where: {
          branchId: lecturer.branchId,
          level: lecturer.level,
          ...(lecturer.sessionSlot ? { sessionSlot: lecturer.sessionSlot } : {}),
          status: "active",
        },
        select: {
          id: true,
          studentCode: true,
          level: true,
          sessionSlot: true,
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const branches = await prisma.branch.findMany({
    where: { status: "active" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, mode: true },
  });

  return NextResponse.json({
    profile: {
      id: lecturer.id,
      name: lecturer.user.name,
      email: lecturer.user.email,
      phone: lecturer.phone,
      bio: lecturer.bio,
      specialization: lecturer.specialization,
      branchId: lecturer.branchId,
      branchName: lecturer.branch?.name ?? null,
      isOnlineBranch: lecturer.branch?.mode === "online",
      level: lecturer.level,
      sessionSlot: lecturer.sessionSlot,
    },
    cohort: {
      assigned: Boolean(lecturer.branchId && lecturer.level),
      label: roomDisplayName({
        branchName: lecturer.branch?.name,
        level: lecturer.level,
        sessionSlot: lecturer.sessionSlot,
      }),
      roomName: cohortRoomName({
        branchName: lecturer.branch?.name,
        level: lecturer.level,
        sessionSlot: lecturer.sessionSlot,
      }),
      studentCount: roster.length,
    },
    roster: roster.map((student) => ({
      id: student.id,
      name: student.user.name || student.user.email,
      email: student.user.email,
      studentCode: student.studentCode,
      level: student.level,
      sessionSlot: student.sessionSlot,
    })),
    branches,
    levels: LEVELS,
    slots: SLOTS,
  });
}

/**
 * Update the tutor's own details, their cohort assignment, or their password.
 *
 * Password changes go through the same route because they are the same form to
 * the person using it, but they require the current password — a hijacked
 * session must not be able to lock the real tutor out.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireLecturer();
  if (auth.error) return auth.error;
  const { lecturer } = auth;

  try {
    const body = await request.json().catch(() => ({}));

    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (newPassword) {
      if (newPassword.length < 8) {
        return NextResponse.json({ error: "Your new password must be at least 8 characters" }, { status: 400 });
      }

      const account = await prisma.user.findUnique({
        where: { id: lecturer.userId },
        select: { password: true },
      });
      const matches = account?.password ? await bcryptjs.compare(currentPassword, account.password) : false;
      if (!matches) {
        return NextResponse.json({ error: "Your current password is not correct" }, { status: 403 });
      }

      await prisma.user.update({
        where: { id: lecturer.userId },
        data: { password: await bcryptjs.hash(newPassword, 10) },
      });
    }

    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    if (name) {
      await prisma.user.update({ where: { id: lecturer.userId }, data: { name } });
    }

    const level = typeof body.level === "string" ? body.level.trim().toUpperCase() : undefined;
    const sessionSlot = typeof body.sessionSlot === "string" ? body.sessionSlot.trim().toLowerCase() : undefined;

    if (level && !(LEVELS as readonly string[]).includes(level)) {
      return NextResponse.json({ error: `Level must be one of ${LEVELS.join(", ")}` }, { status: 400 });
    }
    if (sessionSlot && !(SLOTS as readonly string[]).includes(sessionSlot)) {
      return NextResponse.json({ error: `Session must be one of ${SLOTS.join(", ")}` }, { status: 400 });
    }

    await prisma.lecturer.update({
      where: { id: lecturer.id },
      data: {
        phone: typeof body.phone === "string" ? body.phone.trim() || null : undefined,
        bio: typeof body.bio === "string" ? body.bio.trim() || null : undefined,
        specialization: typeof body.specialization === "string" ? body.specialization.trim() || null : undefined,
        branchId: typeof body.branchId === "string" ? body.branchId || null : undefined,
        level: level ?? undefined,
        sessionSlot: sessionSlot ?? undefined,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Lecturer profile update failed", error);
    return NextResponse.json({ error: "Could not save your changes" }, { status: 500 });
  }
}
