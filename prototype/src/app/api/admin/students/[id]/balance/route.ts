import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { sendDueFeeReminders } from "@/lib/fee-reminders";
import {
  cancelPaymentPlan,
  createPaymentPlan,
  evaluatePlanAdherence,
  planStatusForStudent,
} from "@/lib/payment-plans";
import { loadStudentLedger } from "@/lib/tuition-charges";

/**
 * What the office does about a part-payer's balance, from the student file:
 *
 *   GET                                    — the active payment plan + adherence.
 *   PATCH  { graceUntil: string | null }   — one-off hold on the lock/reminders
 *          until a date (transfer in flight). For a real schedule use a plan.
 *   POST   { action: "sendReminder" }      — send the due balance email now.
 *   POST   { action: "createPlan", installments: [{dueOn, amount}], graceDays?,
 *            note? }                        — a tracked instalment schedule.
 *            While it is kept to, the lock and reminders are held; a missed
 *            instalment defaults it (src/lib/payment-plans.ts).
 *   POST   { action: "cancelPlan", planId } — retire the active plan.
 *
 * Gated on `payments`, not `students`: this is a money decision, and the
 * dossier already withholds amounts from an admin without it.
 */

async function loadScopedStudent(id: string, tenantId: string | null | undefined) {
  const student = await prisma.student.findUnique({
    where: { id },
    select: { id: true, branch: { select: { tenantId: true } } },
  });
  if (!student) return null;
  if (tenantId && student.branch?.tenantId !== tenantId) return null;
  return student;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const student = await loadScopedStudent(id, gate.session.user.tenantId);
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const status = await planStatusForStudent(id);
  return NextResponse.json({
    plan: status?.plan ?? null,
    adherence: status?.adherence ?? null,
  });
}

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

  const student = await loadScopedStudent(id, gate.session.user.tenantId);
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  if (body.action === "sendReminder") {
    const result = await sendDueFeeReminders({ studentId: id, forceSend: true });
    return NextResponse.json({ ok: true, ...result });
  }

  if (body.action === "createPlan") {
    try {
      const installments = Array.isArray(body.installments)
        ? body.installments.map((row: unknown) => {
            const entry = (row ?? {}) as Record<string, unknown>;
            return { dueOn: String(entry.dueOn ?? ""), amount: Number(entry.amount) || 0 };
          })
        : [];
      // Default the target charges to every open go-forward charge, oldest first.
      const ledger = await loadStudentLedger(id);
      const chargeIds = Array.isArray(body.chargeIds) && body.chargeIds.length
        ? body.chargeIds.map(String)
        : ledger.lines.filter((line) => line.outstanding > 0).map((line) => line.chargeId);

      const plan = await createPaymentPlan({
        studentId: id,
        chargeIds,
        installments,
        graceDays: Number(body.graceDays) || undefined,
        note: typeof body.note === "string" ? body.note : undefined,
        createdById: gate.admin.userId,
      });
      const adherence = evaluatePlanAdherence(plan, ledger.lifetimePaid);
      return NextResponse.json({ ok: true, plan, adherence });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not create the payment plan." },
        { status: 400 },
      );
    }
  }

  if (body.action === "cancelPlan") {
    if (typeof body.planId !== "string") {
      return NextResponse.json({ error: "planId is required." }, { status: 400 });
    }
    await cancelPaymentPlan(body.planId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
