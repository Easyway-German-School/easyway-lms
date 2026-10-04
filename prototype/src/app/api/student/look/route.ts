import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeAvatar } from "@/lib/avatar";
import { parseLookChoice } from "@/lib/youth-look";
import { decideLookForStudent } from "@/lib/youth-look-server";

export const dynamic = "force-dynamic";

const SELECT = {
  id: true,
  tenantId: true,
  uiLook: true,
  avatar: true,
  admission: true,
  profile: { select: { dateOfBirth: true } },
  user: { select: { name: true } },
} as const;

/**
 * Which portal look this student gets, and the avatar that goes with it.
 *
 * One tiny call the shell makes on load. It answers the rollout question
 * (src/lib/youth-look.ts) on the server, so the birth date it is decided from
 * never leaves it — the browser only ever learns "youth" or "classic", plus
 * whether that was the student's own choice or the age wave.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    select: SELECT,
  });
  // Tutors and admins are not students; they simply have no new look yet.
  if (!student) return NextResponse.json({ look: "classic", reason: "default", inWave: false, avatar: null, name: null });

  const decision = await decideLookForStudent(student);
  return NextResponse.json({
    look: decision.look,
    reason: decision.reason,
    inWave: decision.inWave,
    avatar: sanitizeAvatar(student.avatar),
    name: student.user?.name ?? null,
  });
}

/**
 * The student picks a look — or hands the choice back to the school with
 * `null`, which is how "reset to what everyone my age gets" works.
 */
export async function PUT(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // An admin viewing the portal as a student must not change that student's settings.
  if (session.user.impersonatedBy) {
    return NextResponse.json({ error: "You are viewing as this student, so this is read-only." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { look?: unknown } | null;
  if (!body || !("look" in body)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const choice = body.look === null ? null : parseLookChoice(body.look);
  if (body.look !== null && !choice) return NextResponse.json({ error: "Unknown look" }, { status: 400 });

  const existing = await prisma.student.findUnique({ where: { userId: session.user.id as string }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not a student account" }, { status: 403 });

  const student = await prisma.student.update({
    where: { id: existing.id },
    data: { uiLook: choice },
    select: SELECT,
  });

  const decision = await decideLookForStudent(student);
  return NextResponse.json({
    look: decision.look,
    reason: decision.reason,
    inWave: decision.inWave,
    avatar: sanitizeAvatar(student.avatar),
    name: student.user?.name ?? null,
  });
}
