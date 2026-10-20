import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { buildLedger } from "@/lib/finance/ledger";
import { LEVELS } from "@/lib/levels";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { getStudentAccess } from "@/lib/student-access";
import { receivedPaymentFilter } from "@/lib/payment";

class ClearDebtError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

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
  const studentId = typeof input.studentId === "string" ? input.studentId.trim() : "";
  const expectedOutstanding =
    typeof input.expectedOutstanding === "number" ? Math.round(input.expectedOutstanding) : -1;
  if (!studentId || expectedOutstanding <= 0 || input.confirm !== true) {
    return NextResponse.json(
      { error: "Student, outstanding balance, and explicit confirmation are required." },
      { status: 400 },
    );
  }

  const studentWhere: Prisma.StudentWhereInput = {
    id: studentId,
    user: { is: { role: "STUDENT" } },
  };
  if (gate.session.user.tenantId) {
    studentWhere.OR = [
      { branch: { tenantId: gate.session.user.tenantId } },
      { user: { tenantId: gate.session.user.tenantId } },
    ];
  }
  const branchIds = scopedBranchIds(gate.admin);
  if (branchIds) studentWhere.branchId = { in: branchIds };

  let saved = false;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findFirst({
        where: studentWhere,
        select: {
          id: true,
          level: true,
          user: { select: { name: true, email: true } },
        },
      });
      if (!student) throw new ClearDebtError("Student not found.", 404);

      const currentPosition = (LEVELS as readonly string[]).indexOf(student.level.trim().toUpperCase());
      if (currentPosition <= 0) {
        throw new ClearDebtError("This student has no earlier level on the progression ladder.", 409);
      }

      const [charges, payments] = await Promise.all([
        tx.tuitionCharge.findMany({
          where: { studentId, deletedAt: null },
          select: {
            id: true,
            level: true,
            amount: true,
            waivedAmount: true,
            legacyArrears: true,
            historyStatus: true,
            historicalPaidAmount: true,
            createdAt: true,
          },
        }),
        tx.payment.findMany({
          where: { studentId, ...receivedPaymentFilter() },
          select: { amount: true, level: true, description: true, createdAt: true },
        }),
      ]);

      const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
      const ledger = buildLedger(charges, totalPaid, new Date(), payments);
      const chargeById = new Map(charges.map((charge) => [charge.id, charge]));
      const debts = ledger.lines.flatMap((line) => {
        const position = (LEVELS as readonly string[]).indexOf(line.level.trim().toUpperCase());
        const charge = chargeById.get(line.chargeId);
        return position >= 0 && position < currentPosition && line.outstanding > 0 && charge
          ? [{ line, charge }]
          : [];
      });
      const amountToWriteOff = debts.reduce((sum, debt) => sum + debt.line.outstanding, 0);
      if (amountToWriteOff <= 0) {
        throw new ClearDebtError("There is no confirmed previous-level debt to write off.", 409);
      }
      if (amountToWriteOff !== expectedOutstanding) {
        throw new ClearDebtError("The previous-level balance changed. Refresh the payments page before confirming.", 409);
      }

      const actor = gate.session.user.email || gate.session.user.name || "authorized staff";
      const reason = `Previous-level debt written off by ${actor} on ${new Date().toISOString()}.`;
      const before = debts.map(({ line, charge }) => ({
        chargeId: charge.id,
        level: line.level,
        outstanding: line.outstanding,
        waivedAmount: charge.waivedAmount,
      }));

      for (const { line, charge } of debts) {
        await tx.tuitionCharge.update({
          where: { id: charge.id },
          data: {
            waivedAmount: Math.min(charge.amount, charge.waivedAmount + line.outstanding),
            waivedReason: reason,
          },
        });
      }

      return {
        student,
        amountToWriteOff,
        before,
        after: debts.map(({ line, charge }) => ({
          chargeId: charge.id,
          level: line.level,
          waivedAmount: Math.min(charge.amount, charge.waivedAmount + line.outstanding),
        })),
      };
    });
    saved = true;

    await writeAudit(
      unguardedPrisma,
      {
        action: "previousLevelDebtWrittenOff",
        model: "TuitionCharge",
        recordId: result.before[0]?.chargeId ?? null,
        before: result.before,
        after: {
          studentId,
          amountWrittenOff: result.amountToWriteOff,
          charges: result.after,
        },
        affectedCount: result.after.length,
        severity: "high",
        summary: `Wrote off ₦${result.amountToWriteOff.toLocaleString("en-NG")} of previous-level tuition for ${result.student.user.name || result.student.user.email}.`,
      },
      { required: true },
    );

    const access = await getStudentAccess(studentId);
    return NextResponse.json({
      ok: true,
      amountWrittenOff: result.amountToWriteOff,
      levels: result.after.map((charge) => charge.level),
      portalUnlocked: access?.hasAccess ?? false,
      lockReason: access?.lockReason ?? null,
    });
  } catch (error) {
    if (error instanceof ClearDebtError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to write off previous-level debt:", { studentId, error });
    return NextResponse.json(
      {
        error: saved
          ? "The debt write-off was saved, but its audit record could not be confirmed. Refresh the record before making another change."
          : "Unable to write off previous-level debt.",
      },
      { status: 500 },
    );
  }
}
