import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeAvatar } from "@/lib/avatar";
import { parseLookChoice } from "@/lib/youth-look";
import { decideLookForStudent, recordLookEvent } from "@/lib/youth-look-server";

export const dynamic = "force-dynamic";

const PROMPTS = new Set(["announce", "invite"]);

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
  if (!student) return { look: "classic", reason: "default", cohort: "invited", inWave: false, prompt: null, avatar: null, name: null };
  const decision = await decideLookForStudent(student);
  return {
    look: decision.look,
    reason: decision.reason,
    cohort: decision.cohort,
    inWave: decision.inWave,
    // Becca's popup: "announce" for the wave, "invite" for everyone else,
    // null for anyone already shown it or who has already chosen.
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
 * (src/lib/youth-look.ts) on the server, so the birth date it is decided from
 * never leaves it — the browser only learns "youth" or "classic". Tutors and
 * admins are not students; they simply have no new look yet.
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
 *   { promptDeclined: "announce" | "invite" }  ...and they said "no thanks"
 *   { look, via: "announce" | "invite" }  a pick made from Becca's popup (only for the record)
 * Picking a look also counts as having seen the popup — that was the answer.
 *
 * Every one of these is also written down as a look event, so the school can
 * see how the invitation is landing (see /api/admin/community/insights).
 */
export async function PUT(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // An admin viewing the portal as a student must not change that student's settings.
  if (session.user.impersonatedBy) {
    return NextResponse.json({ error: "You are viewing as this student, so this is read-only." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    look?: unknown;
    promptSeen?: unknown;
    promptDeclined?: unknown;
    via?: unknown;
  } | null;
  const declined = typeof body?.promptDeclined === "string" && PROMPTS.has(body.promptDeclined) ? body.promptDeclined : null;
  const via = typeof body?.via === "string" && PROMPTS.has(body.via) ? body.via : null;
  if (!body || (!("look" in body) && body.promptSeen !== true && !declined)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const data: { uiLook?: string | null; lookPromptedAt?: Date } = {};
  if ("look" in body) {
    const choice = body.look === null ? null : parseLookChoice(body.look);
    if (body.look !== null && !choice) return NextResponse.json({ error: "Unknown look" }, { status: 400 });
    data.uiLook = choice;
    if (choice) data.lookPromptedAt = new Date();
  }
  if (body.promptSeen === true || declined) data.lookPromptedAt = new Date();

  const existing = await load(session.user.id as string);
  if (!existing) return NextResponse.json({ error: "Not a student account" }, { status: 403 });

  // What they were seeing before this request, for the record.
  const before = await decideLookForStudent(existing);

  // First answer wins the timestamp: re-showing the popup must never be possible by re-saving.
  if (existing.lookPromptedAt) delete data.lookPromptedAt;

  const student = Object.keys(data).length
    ? await prisma.student.update({ where: { id: existing.id }, data, select: SELECT })
    : existing;

  const after = await answer(student);

  // The decisions, written down. The shown/declined labels carry which message it was.
  const userId = existing.user.id;
  if ("look" in body && body.look !== (existing.uiLook ?? null)) {
    const viaPrompt = via ? `:via-${via}` : "";
    await recordLookEvent({
      userId,
      tenantId: existing.tenantId,
      detail: body.look === null ? "reset-to-default" : `switch-to-${body.look}${viaPrompt}`,
      look: after.look === "youth" ? "youth" : "classic",
    });
  }
  if (body.promptSeen === true && !existing.lookPromptedAt && before.prompt) {
    await recordLookEvent({
      userId,
      tenantId: existing.tenantId,
      detail: `prompt-shown:${before.prompt}`,
      look: before.look,
    });
  }
  if (declined) {
    await recordLookEvent({
      userId,
      tenantId: existing.tenantId,
      detail: `prompt-declined:${declined}`,
      look: before.look,
    });
  }

  return NextResponse.json(after);
}
