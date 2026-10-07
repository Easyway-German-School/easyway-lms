import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAnyCapability, scopedBranchIds } from "@/lib/admin-roles";
import { batchFromAdmission } from "@/lib/batch";
import { buildLedger } from "@/lib/finance/ledger";
import { defaultCurrentIntake } from "@/lib/intake";
import { nextLevelAfter } from "@/lib/levels";
import { receivedPaymentFilter, tuitionFeeFor } from "@/lib/payment";

/**
 * Student lookup for the payments desk.
 *
 * The ledger form used to load `/api/admin/students` page 1 (twenty newest
 * names) into a `<select>`. Anyone from an earlier batch — August, sitting
 * A2 in October — was simply not in the list. This is a name/email/code
 * search across the whole roster, with the per-level history attached so
 * the office can see that Elizabeth did A1 in August and is now in A2.
 */

export type EnrolmentSnapshot = {
  id: string;
  level: string;
  batchMonth: string | null;
  batchYear: number | null;
  outcome: string;
  feeSnapshot: number | null;
  branchName: string | null;
};

export type LedgerLineSnapshot = {
  level: string;
  amount: number;
  allocated: number;
  outstanding: number;
  settled: boolean;
};

export type PaymentStudentCard = {
  id: string;
  studentCode: string | null;
  name: string;
  email: string;
  level: string;
  classType: string;
  pathway: string;
  status: string;
  currentBatchMonth: string | null;
  nextLevel: string | null;
  nextLevelFee: number;
  returning: boolean;
  enrolments: EnrolmentSnapshot[];
  paid: number;
  owed: number;
  lines: LedgerLineSnapshot[];
  suggested: {
    current: { level: string; outstanding: number; batchLabel: string } | null;
    next: { level: string; fee: number; batchHint: string } | null;
  };
};

function batchLabel(month: string | null | undefined, year: number | null | undefined): string {
  const m = String(month ?? "").trim();
  if (!m) return "";
  return year ? `${m} ${year}` : m;
}

export async function GET(request: Request) {
  const gate = await requireAnyCapability(["payments", "enrolment"]);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || url.searchParams.get("search") || "").trim();
  const id = (url.searchParams.get("id") || "").trim();

  if (!id && q.length < 2) {
    return NextResponse.json({ students: [] as PaymentStudentCard[] });
  }

  const allowedBranchIds = scopedBranchIds(gate.admin);
  const where: any = {
    user: { is: { role: "STUDENT" } },
  };

  if (gate.session.user.tenantId) {
    where.OR = [
      { branch: { tenantId: gate.session.user.tenantId } },
      { user: { tenantId: gate.session.user.tenantId } },
    ];
  }
  if (allowedBranchIds) {
    where.branchId = { in: allowedBranchIds };
  }

  if (id) {
    where.id = id;
  } else {
    where.AND = [
      {
        OR: [
          { user: { name: { contains: q, mode: "insensitive" as const } } },
          { user: { email: { contains: q, mode: "insensitive" as const } } },
          { studentCode: { contains: q, mode: "insensitive" as const } },
        ],
      },
    ];
  }

  const rows = await prisma.student.findMany({
    where,
    take: id ? 1 : 12,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      studentCode: true,
      level: true,
      classType: true,
      pathway: true,
      status: true,
      admission: true,
      user: { select: { name: true, email: true } },
      branch: { select: { name: true } },
      enrolments: {
        where: { deletedAt: null },
        orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          level: true,
          batchMonth: true,
          batchYear: true,
          outcome: true,
          feeSnapshot: true,
          branch: { select: { name: true } },
        },
      },
    },
  });

  const ids = rows.map((row) => row.id);
  const [charges, payments] = ids.length
    ? await Promise.all([
        prisma.tuitionCharge.findMany({
          where: { studentId: { in: ids }, deletedAt: null },
          select: {
            id: true,
            studentId: true,
            level: true,
            amount: true,
            waivedAmount: true,
            legacyArrears: true,
            createdAt: true,
          },
        }),
        prisma.payment.findMany({
          where: { studentId: { in: ids }, ...receivedPaymentFilter() },
          select: { studentId: true, amount: true },
        }),
      ])
    : [[], []];

  const chargesByStudent = new Map<string, typeof charges>();
  for (const charge of charges) {
    const list = chargesByStudent.get(charge.studentId) ?? [];
    list.push(charge);
    chargesByStudent.set(charge.studentId, list);
  }
  const paidByStudent = new Map<string, number>();
  for (const payment of payments) {
    paidByStudent.set(payment.studentId, (paidByStudent.get(payment.studentId) ?? 0) + payment.amount);
  }

  const intake = defaultCurrentIntake();
  const intakeLabel = `${intake.month} ${intake.year}`;

  const students: PaymentStudentCard[] = rows.map((row) => {
    const ledger = buildLedger(chargesByStudent.get(row.id) ?? [], paidByStudent.get(row.id) ?? 0);
    const currentBatchMonth =
      row.enrolments.find((enrolment) => enrolment.outcome === "ongoing")?.batchMonth ??
      batchFromAdmission(row.admission);
    const currentBatchYear =
      row.enrolments.find((enrolment) => enrolment.outcome === "ongoing")?.batchYear ?? null;
    const currentLine = ledger.lines.find((line) => line.level === row.level);
    const currentFee = tuitionFeeFor({
      level: row.level,
      branch: row.branch?.name ?? null,
      classType: row.classType,
      pathway: row.pathway,
    });
    const next = nextLevelAfter(row.level);
    const nextFee = next
      ? tuitionFeeFor({
          level: next,
          branch: row.branch?.name ?? null,
          classType: row.classType,
          pathway: row.pathway,
        })
      : 0;
    const previous = row.enrolments.filter((enrolment) => enrolment.outcome !== "ongoing");
    const missingCurrent = !currentLine;
    const currentOutstanding = currentLine?.outstanding ?? currentFee;
    const currentSettled = currentLine ? currentLine.settled : false;

    return {
      id: row.id,
      studentCode: row.studentCode,
      name: row.user.name || row.user.email,
      email: row.user.email,
      level: row.level,
      classType: row.classType,
      pathway: row.pathway,
      status: row.status,
      currentBatchMonth,
      nextLevel: next,
      nextLevelFee: nextFee,
      returning: previous.length > 0,
      enrolments: row.enrolments.map((enrolment) => ({
        id: enrolment.id,
        level: enrolment.level,
        batchMonth: enrolment.batchMonth,
        batchYear: enrolment.batchYear,
        outcome: enrolment.outcome,
        feeSnapshot: enrolment.feeSnapshot,
        branchName: enrolment.branch?.name ?? null,
      })),
      paid: ledger.lifetimePaid,
      owed: ledger.lifetimeOutstanding + (missingCurrent ? currentFee : 0),
      lines: [
        ...ledger.lines.map((line) => ({
          level: line.level,
          amount: line.net,
          allocated: line.allocated,
          outstanding: line.outstanding,
          settled: line.settled,
        })),
        ...(missingCurrent && row.level
          ? [{ level: row.level, amount: currentFee, allocated: 0, outstanding: currentFee, settled: false }]
          : []),
      ],
      suggested: {
        current:
          !currentSettled || currentOutstanding > 0
            ? {
                level: row.level,
                outstanding: currentOutstanding,
                batchLabel: batchLabel(currentBatchMonth, currentBatchYear) || row.level,
              }
            : null,
        next: next
          ? {
              level: next,
              fee: nextFee,
              batchHint: intakeLabel,
            }
          : null,
      },
    };
  });

  return NextResponse.json({ students });
}
