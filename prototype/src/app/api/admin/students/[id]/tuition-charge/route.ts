import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { LEVELS } from "@/lib/levels";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { getStudentAccess } from "@/lib/student-access";

/**
 * Lets an admin correct what a single level actually costs a single student.
 *
 * This exists because "the price is wrong on my dashboard" is almost always
 * NOT a price-book bug (see the FIFO-rollover case this was built for: a
 * student's screen correctly showed a smaller number because an earlier
 * overpayment had already been credited forward) — but every so often a
 * `TuitionCharge` really was raised wrong (an import, a branch mix-up, a
 * manual promotion typo) and the office needs a direct, audited way to fix
 * THAT ONE row rather than wait for a redeploy of the price book.
 *
 * Writes straight to `TuitionCharge.amount`, which is the one field the whole
 * money stack already reads off: the ledger (`buildLedger`, FIFO reconciler),
 * `accessFromStudent`/`getStudentAccess` (portal lock, dashboard, checkout),
 * and every admin payments screen that lists a student's balance. No other
 * change is needed for this to "reflect everywhere" — it already does.
 */
class TuitionChargeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function studentScope(gate: Awaited<ReturnType<typeof requireCapability>> & { ok: true }, studentId: string) {
  const where: Prisma.StudentWhereInput = {
    id: studentId,
    user: { is: { role: "STUDENT" } },
  };
  if (gate.session.user.tenantId) {
    where.OR = [
      { branch: { tenantId: gate.session.user.tenantId } },
      { user: { tenantId: gate.session.user.tenantId } },
    ];
  }
  const branchIds = scopedBranchIds(gate.admin);
  if (branchIds) where.branchId = { in: branchIds };
  return where;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;
  const { id: studentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON body is required." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "A valid JSON object is required." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const level = typeof input.level === "string" ? input.level.trim().toUpperCase() : "";
  const amount = typeof input.amount === "number" ? Math.round(input.amount) : NaN;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";

  if (!(LEVELS as readonly string[]).includes(level)) {
    return NextResponse.json({ error: "Unrecognized level." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) {
    return NextResponse.json({ error: "Enter a whole-naira amount between 0 and 10,000,000." }, { status: 400 });
  }
  if (reason.length < 8) {
    return NextResponse.json(
      { error: "A reason is required (at least 8 characters) — this is a financial record." },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findFirst({
        where: studentScope(gate, studentId),
        select: {
          id: true,
          level: true,
          classType: true,
          pathway: true,
          tenantId: true,
          branch: { select: { name: true } },
          user: { select: { name: true, email: true } },
        },
      });
      if (!student) throw new TuitionChargeError("Student not found.", 404);

      const existing = await tx.tuitionCharge.findUnique({
        where: { studentId_level_attempt: { studentId, level, attempt: 1 } },
        select: { id: true, amount: true, note: true, deletedAt: true },
      });

      const actor = gate.session.user.email || gate.session.user.name || "authorized staff";
      const stamp = `Tuition corrected by ${actor} on ${new Date().toISOString()}: ${reason} (was ₦${(existing?.amount ?? 0).toLocaleString("en-NG")}, now ₦${amount.toLocaleString("en-NG")}).`;

      let chargeId: string;
      let before: number;
      if (existing) {
        before = existing.amount;
        const note = existing.note ? `${existing.note} · ${stamp}` : stamp;
        const updated = await tx.tuitionCharge.update({
          where: { id: existing.id },
          data: { amount, note, deletedAt: null, origin: "admin" },
          select: { id: true },
        });
        chargeId = updated.id;
      } else {
        before = 0;
        const created = await tx.tuitionCharge.create({
          data: {
            studentId,
            level,
            attempt: 1,
            amount,
            classType: student.classType ?? "group",
            branchName: student.branch?.name ?? null,
            origin: "admin",
            note: stamp,
            ...(student.tenantId ? { tenantId: student.tenantId } : {}),
          },
          select: { id: true },
        });
        chargeId = created.id;
      }

      return { student, chargeId, before };
    });

    await writeAudit(
      unguardedPrisma,
      {
        action: "tuitionChargeAmountCorrected",
        model: "TuitionCharge",
        recordId: result.chargeId,
        before: { level, amount: result.before },
        after: { level, amount, reason },
        affectedCount: 1,
        severity: "high",
        summary: `Corrected ${level} tuition for ${result.student.user.name || result.student.user.email} from ₦${result.before.toLocaleString("en-NG")} to ₦${amount.toLocaleString("en-NG")}.`,
      },
      { required: true },
    );

    const access = await getStudentAccess(studentId);
    return NextResponse.json({
      ok: true,
      level,
      amount,
      fee: access?.tuitionFee ?? null,
      owed: access?.currentLevelOutstanding ?? null,
      portalUnlocked: access?.hasAccess ?? false,
      lockReason: access?.lockReason ?? null,
    });
  } catch (error) {
    if (error instanceof TuitionChargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to correct tuition charge:", { studentId, error });
    return NextResponse.json({ error: "Unable to save the corrected amount." }, { status: 500 });
  }
}
