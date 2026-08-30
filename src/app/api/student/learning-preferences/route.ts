import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * THE COLD-START SEED for the personalised study plan.
 *
 * Behaviour-driven personalisation (src/lib/learner-style.ts) needs about a
 * fortnight of real use before it can say anything. This endpoint holds the
 * one thing worth asking outright in the meantime: does this learner want to
 * watch, read, or practise, and in what size of sitting. It is a PRIOR, not a
 * setting — the style engine folds it in only where it has no behaviour of its
 * own yet, and drops it entirely once the real pattern is legible. There is
 * deliberately no "advanced preferences" screen; a knob the student has to
 * maintain is a knob that goes stale.
 */

export const dynamic = "force-dynamic";

const FORMATS = new Set(["watch", "read", "practice", "mixed"]);
const PACES = new Set(["short", "standard", "deep"]);

type Seed = { format?: string; pace?: string; setAt?: string };

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    select: { learningPreferences: true },
  });
  if (!student) return NextResponse.json({ error: "Not a student account" }, { status: 403 });

  const seed = (student.learningPreferences ?? null) as Seed | null;
  return NextResponse.json({
    format: seed?.format ?? null,
    pace: seed?.pace ?? null,
    answered: Boolean(seed?.format || seed?.pace),
  });
}

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { format?: unknown; pace?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const format = typeof body.format === "string" && FORMATS.has(body.format) ? body.format : undefined;
  const pace = typeof body.pace === "string" && PACES.has(body.pace) ? body.pace : undefined;
  if (!format && !pace) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    select: { id: true, learningPreferences: true },
  });
  if (!student) return NextResponse.json({ error: "Not a student account" }, { status: 403 });

  // Merge, so answering one question later does not wipe the other.
  const existing = (student.learningPreferences ?? {}) as Seed;
  const next: Seed = {
    ...existing,
    ...(format ? { format } : {}),
    ...(pace ? { pace } : {}),
    setAt: new Date().toISOString(),
  };

  await prisma.student.update({
    where: { id: student.id },
    data: { learningPreferences: next },
  });

  /**
   * The plan is cached for an hour. A student who has just told us how they
   * learn should not have to wait that out to see it take effect, so the
   * cached copy is dropped and the next load regenerates against the seed.
   */
  await prisma.personalizedPlan.deleteMany({ where: { studentId: student.id } });

  return NextResponse.json({ ok: true, format: next.format ?? null, pace: next.pace ?? null });
}
