import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcryptjs from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LEVELS } from "@/lib/levels";
import { cohortRoomName } from "@/lib/live-classroom";
import {
  describeAssignment,
  isAssigned,
  matchesBatch,
  readAssignment,
  studentWhereForAssignment,
} from "@/lib/lecturer-assignment";

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

  const branches = await prisma.branch.findMany({
    where: { status: "active" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, mode: true },
  });

  // The cohort comes from the ADMIN-SET assignment, read through the same
  // helper the roster and attendance use, so all three agree about who is in
  // this tutor's class.
  const assignment = readAssignment(lecturer);
  const where = studentWhereForAssignment(assignment);

  const roster = where
    ? (
        await prisma.student.findMany({
          where: { ...(where as Record<string, unknown>), status: "active" } as any,
          select: {
            id: true,
            studentCode: true,
            level: true,
            sessionSlot: true,
            admission: true,
            branch: { select: { name: true } },
            user: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: "asc" },
        })
      ).filter((student) => matchesBatch(assignment, student.admission))
    : [];

  return NextResponse.json({
    profile: {
      id: lecturer.id,
      name: lecturer.user.name,
      email: lecturer.user.email,
      phone: lecturer.phone,
      photoUrl: lecturer.photoUrl,
      bio: lecturer.bio,
      specialization: lecturer.specialization,
      branchId: lecturer.branchId,
      branchName: lecturer.branch?.name ?? null,
      isOnlineBranch: lecturer.branch?.mode === "online",
      level: lecturer.level,
      sessionSlot: lecturer.sessionSlot,
    },
    // What the admin assigned. Sent so the tutor portal can SHOW it; there is
    // no longer any route by which the tutor can change it.
    assignment,
    cohort: {
      assigned: isAssigned(assignment),
      label: describeAssignment(assignment, new Map(branches.map((branch) => [branch.id, branch.name]))),
      /**
       * The live room is still keyed on the tutor's PRIMARY class — one tutor
       * cannot be in two rooms at once, so a multi-branch assignment still has
       * to pick one, and the primary mirrors the first branch and level the
       * admin selected.
       */
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
      branchName: student.branch?.name ?? null,
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

    /**
     * A tutor cannot assign themselves.
     *
     * Branch, level, sitting, class type and batch all belong to the admin —
     * they decide who teaches which class, and a tutor who could move
     * themselves could pull another tutor's whole roster, attendance history
     * and gradebook onto their own dashboard by changing one dropdown.
     *
     * Rejected loudly rather than ignored silently, so a client still sending
     * the old fields finds out instead of appearing to save.
     */
    const assignmentKeys = ["branchId", "branchIds", "level", "levels", "sessionSlot", "sessionSlots", "classTypes", "batches"];
    const attempted = assignmentKeys.filter((key) => body[key] !== undefined);
    if (attempted.length > 0) {
      return NextResponse.json(
        {
          error:
            "Your branch, level and class sessions are set by the school office. Contact them to change which class you take.",
          rejectedFields: attempted,
        },
        { status: 403 },
      );
    }

    await prisma.lecturer.update({
      where: { id: lecturer.id },
      data: {
        phone: typeof body.phone === "string" ? body.phone.trim() || null : undefined,
        bio: typeof body.bio === "string" ? body.bio.trim() || null : undefined,
        specialization: typeof body.specialization === "string" ? body.specialization.trim() || null : undefined,
        // A tutor's own photo is theirs to change — it says nothing about
        // which class they teach.
        photoUrl: typeof body.photoUrl === "string" ? body.photoUrl.trim() || null : undefined,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Lecturer profile update failed", error);
    return NextResponse.json({ error: "Could not save your changes" }, { status: 500 });
  }
}
