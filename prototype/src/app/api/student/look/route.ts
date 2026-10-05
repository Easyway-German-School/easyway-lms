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
  lookPromptedAt: true,
  createdAt: true,
  avatar: true,
  admission: true,
  profile: { select: { dateOfBirth: true } },
  user: { select: { name: true, id: true } },
} as const;

async function answer(student: Awaited<ReturnType<typeof load>>) {
  if (!student) return { look: "classic", reason: "default", cohort: "classic", inWave: false, prompt: null, avatar: null, name: null };
  const decision = await decideLookForStudent(student, student.user.id);
  return {
    look: decision.look,
    reason: decision.reason,
    cohort: decision.cohort,
    inWave: decision.inWave,
    // Becca's popup: "announce" for the wave, "invite" for the phone-heavy 25–34s,
    // null for everyone else and for anyone already shown it.
    prompt: decision.prompt,
    avatar: sanitizeAvatar(student.avatar),
    name: student.user?.name ?? null,
  };
}

function load(userId: string) {
  return prisma.student.findUnique({ where: { userId }, select: SELECT });
}

/**
 * Which portal look this student gets, the avatar that goes with it, and
 * whether Becca should offer a one-time popup about it.
 *
 * One tiny call the shell makes on load. It answers the rollout question
 * (src/lib/youth-look.ts) on the server, so the birth date and usage it is
 * decided from never leave it — the browser only learns "youth" or "classic".
 * Tutors and admins are not students; they simply have no new look yet.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await answer(await load(session.user.id as string)));
}

/**
 * The student's say. Any of:
 *   { look: "youth" | "classic" | null }  pick a look, or hand it back to the school
 *   { promptSeen: true }                  Becca's popup has been shown
 * Picking a look also counts as having seen the popup — that was the answer.
 */
export async function PUT(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // An admin viewing the portal as a student must not change that student's settings.
  if (session.user.impersonatedBy) {
    return NextResponse.json({ error: "You are viewing as this student, so this is read-only." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { look?: unknown; promptSeen?: unknown } | null;
  if (!body || (!("look" in body) && body.promptSeen !== true)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const data: { uiLook?: string | null; lookPromptedAt?: Date } = {};
  if ("look" in body) {
    const choice = body.look === null ? null : parseLookChoice(body.look);
    if (body.look !== null && !choice) return NextResponse.json({ error: "Unknown look" }, { status: 400 });
    data.uiLook = choice;
    if (choice) data.lookPromptedAt = new Date();
  }
  if (body.promptSeen === true) data.lookPromptedAt = new Date();

  const existing = await load(session.user.id as string);
  if (!existing) return NextResponse.json({ error: "Not a student account" }, { status: 403 });

  // First answer wins the timestamp: re-showing the popup must never be possible by re-saving.
  if (existing.lookPromptedAt) delete data.lookPromptedAt;

  const student = Object.keys(data).length
    ? await prisma.student.update({ where: { id: existing.id }, data, select: SELECT })
    : existing;

  return NextResponse.json(await answer(student));
}
