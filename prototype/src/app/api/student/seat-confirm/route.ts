import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pendingSeatBatchConfirmation, resolveSeatBatchConfirmation } from "@/lib/seat-batch-confirm";

export const dynamic = "force-dynamic";

/**
 * The student's side of Becca's "is this batch really what you meant?" ask —
 * see lib/seat-batch-confirm.ts for why this exists at all. Read-only except
 * for the one answer they give about their own seat.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true } });
  if (!student) return NextResponse.json({ pending: null });

  const pending = await pendingSeatBatchConfirmation(student.id);
  return NextResponse.json({ pending });
}

export async function POST(req: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true } });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const decision = body?.decision === "confirmed" ? "confirmed" : body?.decision === "mistake" ? "mistake" : null;
  if (!decision) return NextResponse.json({ error: "Say 'confirmed' or 'mistake'" }, { status: 400 });

  const result = await resolveSeatBatchConfirmation(student.id, decision);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
  return NextResponse.json({ ok: true, decision: result.decision });
}
