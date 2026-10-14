import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { LEVELS } from "@/lib/levels";
import { buildLedger } from "@/lib/finance/ledger";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { isTravelPackagePathway, receivedPaymentFilter, tuitionFeeFor } from "@/lib/payment";
import { resolvePaymentLevel } from "@/lib/payment-level";

type HistoryClassification = "paid" | "owing" | "not_taken_here";

class HistoryRequestError extends Error {
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

function priorLevelsFor(currentLevel: string): string[] {
  const key = currentLevel.trim().toUpperCase();
  const index = (LEVELS as readonly string[]).indexOf(key);
  return index < 0 ? [] : LEVELS.slice(0, index);
}

export async function GET(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const studentId = new URL(request.url).searchParams.get("studentId")?.trim();
  if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });

  try {
    const student = await prisma.student.findFirst({
      where: studentScope(gate, studentId),
      select: {
        id: true,
        level: true,
        classType: true,
        pathway: true,
        branch: { select: { name: true } },
        enrolments: {
          where: { deletedAt: null },
          orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }],
          select: { id: true, level: true, batchMonth: true, batchYear: true, outcome: true },
        },
      },
    });
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    if (isTravelPackagePathway(student.pathway)) {
      return NextResponse.json({
        currentLevel: student.level,
        levels: [],
        notice: "Travel-package tuition is managed as one package, not as level-by-level history.",
      });
    }

    const levels = priorLevelsFor(student.level);
    if (!levels.length && String(student.level).trim().toUpperCase() !== LEVELS[0]) {
      return NextResponse.json({ error: "The student's current level is not on the progression ladder." }, { status: 409 });
    }

    const [charges, payments] = await Promise.all([
      prisma.tuitionCharge.findMany({
        // Allocate cash across the student's complete ledger before showing
        // the prior-level slice, or current-level payments can appear to have
        // paid an older level merely because its charge was omitted here.
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
          settledAt: true,
        },
      }),
      prisma.payment.findMany({
        where: { studentId, ...receivedPaymentFilter() },
        select: { amount: true, level: true, description: true, createdAt: true },
      }),
    ]);
    const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const ledger = buildLedger(charges, paid, new Date(), payments);
    const chargeByLevel = new Map(charges.map((charge) => [charge.level.toUpperCase(), charge]));
    const lineByLevel = new Map(ledger.lines.map((line) => [line.level.toUpperCase(), line]));
    const enrolmentByLevel = new Map(
      student.enrolments.map((enrolment) => [enrolment.level.toUpperCase(), enrolment]),
    );

    return NextResponse.json({
      currentLevel: student.level,
      levels: levels.map((level) => {
        const charge = chargeByLevel.get(level.toUpperCase());
        const line = lineByLevel.get(level.toUpperCase());
        const enrolment = enrolmentByLevel.get(level.toUpperCase()) ?? null;
        const status =
          line?.historyStatus === "unreviewed"
            ? "unreviewed"
            : line?.historyStatus === "not_taken_here"
              ? "not_taken_here"
              : line && line.outstanding > 0
                ? "owing"
                : charge
                  ? "paid"
                  : "no_record";
        return {
          level,
          status,
          chargeAmount:
            line?.historyStatus === "not_taken_here" ? 0 : charge?.amount ?? null,
          cashPaid: line?.cashAllocated ?? 0,
          historicalPaidAmount: line?.historicalPaidAmount ?? 0,
          outstanding: line?.outstanding ?? 0,
          reviewOutstanding: line?.reviewOutstanding ?? 0,
          enrolment: enrolment
            ? {
                batchMonth: enrolment.batchMonth,
                batchYear: enrolment.batchYear,
                outcome: enrolment.outcome,
              }
            : null,
        };
      }),
    });
  } catch (error) {
    console.error("Failed to load a student's prior-level history:", { studentId, error });
    return NextResponse.json({ error: "Unable to load prior-level history." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON body is required." }, { status: 400 });
  }
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return NextResponse.json({ error: "A valid JSON object is required." }, { status: 400 });
  }
  const body = parsedBody as Record<string, unknown>;

  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  const level = typeof body.level === "string" ? body.level.trim().toUpperCase() : "";
  const classification = body.classification;
  if (!studentId || !level) {
    return NextResponse.json({ error: "studentId and level are required." }, { status: 400 });
  }
  if (classification !== "paid" && classification !== "owing" && classification !== "not_taken_here") {
    return NextResponse.json({ error: "Choose completed and paid, confirmed owing, or not taken here." }, { status: 400 });
  }

  let saved = false;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findFirst({
        where: studentScope(gate, studentId),
        select: {
          id: true,
          level: true,
          classType: true,
          pathway: true,
          branchId: true,
          tutorId: true,
          sessionSlot: true,
          deliveryMode: true,
          tenantId: true,
          branch: { select: { name: true } },
          enrolments: {
            where: { deletedAt: null },
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
            select: { id: true, level: true, outcome: true },
          },
        },
      });
      if (!student) throw new HistoryRequestError("Student not found.", 404);
      if (isTravelPackagePathway(student.pathway)) {
        throw new HistoryRequestError("Travel-package tuition is managed as one package, not as level-by-level history.", 409);
      }

      const priorLevels = priorLevelsFor(student.level);
      if (!priorLevels.includes(level)) {
        throw new HistoryRequestError("Only a level below the student's current level can be classified here.", 400);
      }

      const now = new Date();
      const expectedAmount = tuitionFeeFor({
        level,
        branch: student.branch?.name ?? null,
        classType: student.classType,
        pathway: student.pathway,
      });
      const existing = await tx.tuitionCharge.findUnique({
        where: { studentId_level: { studentId, level } },
        select: {
          id: true,
          amount: true,
          waivedAmount: true,
          note: true,
          historyStatus: true,
          historicalPaidAmount: true,
        },
      });
      const amount =
        existing && existing.amount > 0 && existing.historyStatus !== "not_taken_here"
          ? existing.amount
          : existing?.amount || expectedAmount;
      const noteLine =
        classification === "paid"
          ? "Staff verified prior-level completion and payment history."
          : classification === "owing"
            ? "Staff verified prior-level tuition remains owing."
            : "Staff verified this level was not taken at this school.";
      const note = existing?.note ? `${existing.note} · ${noteLine}` : noteLine;
      let chargeId: string;
      let historicalPaidAmount = 0;
      if (existing) {
        const updated = await tx.tuitionCharge.update({
          where: { id: existing.id },
          data: {
            amount,
            origin: "admin",
            legacyArrears: classification !== "owing",
            historyStatus: classification,
            historicalPaidAmount: 0,
            note,
            deletedAt: null,
          },
          select: { id: true },
        });
        chargeId = updated.id;
      } else {
        const created = await tx.tuitionCharge.create({
          data: {
            studentId,
            level,
            amount: classification === "not_taken_here" ? 0 : amount,
            classType: student.classType ?? "group",
            branchName: student.branch?.name ?? null,
            origin: "admin",
            legacyArrears: classification !== "owing",
            historyStatus: classification,
            historicalPaidAmount: 0,
            note,
            ...(student.tenantId ? { tenantId: student.tenantId } : {}),
          },
          select: { id: true },
        });
        chargeId = created.id;
      }

      if (classification === "not_taken_here") {
        const levelPayments = await tx.payment.findMany({
          where: { studentId, ...receivedPaymentFilter() },
          select: { level: true, description: true },
        });
        if (levelPayments.some((payment) => resolvePaymentLevel(payment) === level)) {
          throw new HistoryRequestError(
            `A received payment is explicitly assigned to ${level}. Review that payment before marking the level as not taken here.`,
            409,
          );
        }
        const enrolment = student.enrolments.find((row) => row.level.toUpperCase() === level);
        if (enrolment) {
          throw new HistoryRequestError(
            `An enrolment record exists for ${level}. Resolve that history record before marking the level as not taken here.`,
            409,
          );
        }
      }

      if (classification === "paid") {
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
              settledAt: true,
            },
          }),
          tx.payment.findMany({
            where: { studentId, ...receivedPaymentFilter() },
            select: { amount: true, level: true, description: true, createdAt: true },
          }),
        ]);
        const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
        const line = buildLedger(charges, totalPaid, now, payments).lines.find(
          (entry) => entry.level.toUpperCase() === level,
        );
        const net = Math.max(0, amount - (existing?.waivedAmount ?? 0));
        historicalPaidAmount = Math.max(0, net - (line?.cashAllocated ?? 0));
        await tx.tuitionCharge.update({
          where: { id: chargeId },
          data: { historyStatus: "paid", historicalPaidAmount },
        });

        const priorEnrolment = student.enrolments.find((row) => row.level.toUpperCase() === level);
        if (priorEnrolment) {
          await tx.studentEnrolment.update({
            where: { id: priorEnrolment.id },
            data: {
              outcome: "completed",
              endedAt: priorEnrolment.outcome === "ongoing" ? now : undefined,
              outcomeNote: "Manually verified by staff as prior-level history.",
              tuitionChargeId: chargeId,
              feeSnapshot: amount,
            },
          });
        } else {
          await tx.studentEnrolment.create({
            data: {
              studentId,
              level,
              branchId: student.branchId,
              tutorId: student.tutorId,
              sessionSlot: student.sessionSlot || "Weekday",
              classType: student.classType ?? "group",
              deliveryMode: student.deliveryMode || "physical",
              startedAt: null,
              endedAt: now,
              outcome: "completed",
              outcomeNote: "Manually verified by staff as prior-level history.",
              tuitionChargeId: chargeId,
              feeSnapshot: amount,
              ...(student.tenantId ? { tenantId: student.tenantId } : {}),
            },
          });
        }
      }

      return {
        chargeId,
        before: {
          historyStatus: existing?.historyStatus ?? "no_record",
          historicalPaidAmount: existing?.historicalPaidAmount ?? 0,
          amount: existing?.amount ?? null,
        },
        after: {
          historyStatus: classification,
          historicalPaidAmount,
          amount: classification === "not_taken_here" && !existing ? 0 : amount,
        },
      };
    });
    saved = true;

    await writeAudit(
      unguardedPrisma,
      {
        action: "manualLevelHistoryReconciled",
        model: "TuitionCharge",
        recordId: result.chargeId,
        before: result.before,
        after: { ...result.after, studentId, level },
        severity: "high",
        summary: `Staff classified ${level} history for student ${studentId} as ${classification}.`,
      },
      { required: true },
    );
    return NextResponse.json({ ok: true, level, classification });
  } catch (error) {
    if (error instanceof HistoryRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to classify prior-level history:", { studentId, level, classification, error });
    return NextResponse.json(
      {
        error: saved
          ? "History was saved, but its audit record could not be confirmed. Refresh the record before making another change."
          : "Unable to save prior-level history.",
      },
      { status: 500 },
    );
  }
}
