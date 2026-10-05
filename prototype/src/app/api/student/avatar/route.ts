import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeAvatar } from "@/lib/avatar";
import { awardCapped } from "@/lib/campus-server";

export const dynamic = "force-dynamic";

/**
 * Save the signed-in student's avatar.
 *
 * The body is run through `sanitizeAvatar`, which snaps every field onto the
 * approved lists, so what lands in the column is always a value the renderer
 * knows how to draw — there is no free text or URL in an avatar to moderate.
 * Reading it back goes through /api/student/look, with the look decision.
 */
export async function PUT(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.impersonatedBy) {
    return NextResponse.json({ error: "You are viewing as this student, so this is read-only." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { avatar?: unknown } | null;
  const avatar = sanitizeAvatar(body?.avatar);
  if (!avatar) return NextResponse.json({ error: "That is not an avatar" }, { status: 400 });

  const student = await prisma.student.findUnique({ where: { userId: session.user.id as string }, select: { id: true, tenantId: true } });
  if (!student) return NextResponse.json({ error: "Not a student account" }, { status: 403 });

  await prisma.student.update({ where: { id: student.id }, data: { avatar } });

  // Making an avatar is the first thing Campus rewards, once per student ever.
  // Best-effort: a hiccup in the coin ledger must never fail the save itself.
  const coins = await awardCapped({ studentId: student.id, tenantId: student.tenantId, reason: "avatar" }).catch(() => ({ awarded: false, amount: 0 }));

  return NextResponse.json({ avatar, coins: coins.amount });
}
