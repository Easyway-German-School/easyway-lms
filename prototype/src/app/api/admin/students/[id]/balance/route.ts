import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { sendDueFeeReminders } from "@/lib/fee-reminders";

/**
 * The two things the office does about a part-payer's balance, from the
 * student file:
 *
 *   PATCH  { graceUntil: string | null }  — hold the portal lock and pause the
 *          balance reminders until a date (payment plan agreed, transfer in
 *          flight), or clear the hold.
 *   POST   { action: "sendReminder" }     — send the due balance email now,
 *          ignoring the schedule (reuses sendDueFeeReminders forceSend).
 *
 * Gated on `payments`, not `students`: this is a money decision, and the
 * dossier already withholds amounts from an admin without it.
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  let graceUntil: Date | null = null;
  if (body.graceUntil !== null && body.graceUntil !== undefined && body.graceUntil !== "") {
    const parsed = new Date(String(body.graceUntil));
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "That date could not be read." }, { status: 400 });
    }
    graceUntil = parsed;
  }

  const student = await prisma.student.findUnique({
    where: { id },
    select: { id: true, branch: { select: { tenantId: true } } },
  });
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  if (gate.session.user.tenantId && student.branch?.tenantId !== gate.session.user.tenantId) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  await prisma.student.update({
    where: { id },
    data: { paymentGraceUntil: graceUntil },
  });

  return NextResponse.json({ ok: true, graceUntil: graceUntil?.toISOString() ?? null });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (body.action !== "sendReminder") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const student = await prisma.student.findUnique({
    where: { id },
    select: { id: true, branch: { select: { tenantId: true } } },
  });
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  if (gate.session.user.tenantId && student.branch?.tenantId !== gate.session.user.tenantId) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const result = await sendDueFeeReminders({ studentId: id, forceSend: true });
  return NextResponse.json({ ok: true, ...result });
}
