import { prisma } from "@/lib/prisma";
import { batchFromAdmission } from "@/lib/batch";
import { resolveUpcomingBatch, seatStatusFor, type SeatStatus } from "@/lib/batch-reservation";
import { accessFromStudent, STUDENT_ACCESS_SELECT } from "@/lib/student-access";
import { isReceivedPayment, isRegistrationFeePayment } from "@/lib/payment";

/**
 * Everyone waiting for an intake that has not opened, with where they stand on
 * their seat.
 *
 * ONE loader for three readers, so they cannot disagree about who is waiting or
 * how much they have paid:
 *   - the student's own waiting-room screen (their seat number, how many seats
 *     are already secured),
 *   - the admin "Upcoming intake" console,
 *   - Becca's seat-reservation nudges (lib/seat-nudges.ts).
 *
 * Cheap first pass, expensive second: a light query over every active student
 * finds who is waiting (the batch lives inside the `admission` JSON, so it
 * cannot be filtered in SQL), and only those learners get the full payment /
 * ledger fetch.
 */

export type SeatRow = {
  studentId: string;
  userId: string | null;
  name: string;
  email: string;
  phone: string;
  branchId: string | null;
  branch: string;
  level: string;
  sessionSlot: string;
  classType: string;
  createdAt: string;
  /** "October" */
  batch: string;
  /** "October 2026" — the grouping key. */
  batchLabel: string;
  startsOn: string;
  daysUntilStart: number;
  seat: SeatStatus;
  /** Tuition received (registration fee excluded). */
  tuitionPaid: number;
  registrationPaid: boolean;
  tuitionFee: number;
  requiredDeposit: number;
  /** Still to pay before the deposit holds the seat. */
  depositOutstanding: number;
  /** Still owed on the whole fee. */
  balanceOutstanding: number;
  /** When their first payment of any kind landed — what "first to reserve" is ranked on. */
  firstPaidAt: string | null;
  /** 1 = first learner in this intake to pay anything. Null until they have. */
  seatNumber: number | null;
};

const LOOKBACK_MONTHS = 18;

function phoneOf(admission: unknown): string {
  if (!admission || typeof admission !== "object") return "";
  const value = (admission as Record<string, unknown>).phone;
  return typeof value === "string" ? value.trim() : "";
}

export async function loadUpcomingBatchRows(
  options: {
    now?: Date;
    studentIds?: string[];
    /** Extra fence for the light query — the admin routes' tenant / branch scope. */
    where?: Record<string, unknown>;
  } = {},
): Promise<SeatRow[]> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime());
  since.setMonth(since.getMonth() - LOOKBACK_MONTHS);

  const light = await prisma.student.findMany({
    where: {
      status: "active",
      createdAt: { gte: since },
      ...(options.where ?? {}),
      ...(options.studentIds ? { id: { in: options.studentIds } } : {}),
    },
    select: { id: true, createdAt: true, classesStartedAt: true, admission: true },
  });

  const waiting = new Map<string, ReturnType<typeof resolveUpcomingBatch>>();
  for (const student of light) {
    const upcoming = resolveUpcomingBatch(batchFromAdmission(student.admission), {
      registeredAt: student.createdAt,
      classesStartedAt: student.classesStartedAt,
      now,
    });
    if (upcoming) waiting.set(student.id, upcoming);
  }
  if (waiting.size === 0) return [];

  const ids = [...waiting.keys()];
  const [students, payments] = await Promise.all([
    prisma.student.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        branchId: true,
        sessionSlot: true,
        user: { select: { id: true, name: true, email: true } },
        ...STUDENT_ACCESS_SELECT,
      },
    }),
    // Every received payment INCLUDING the registration fee — `totalPaid` off
    // the access verdict leaves that out on purpose, but "has this learner
    // put any money down" needs it.
    prisma.payment.findMany({
      where: { studentId: { in: ids }, deletedAt: null },
      select: { studentId: true, amount: true, status: true, description: true, createdAt: true },
    }),
  ]);

  const firstPaid = new Map<string, Date>();
  const registrationPaid = new Set<string>();
  for (const payment of payments) {
    if (!isReceivedPayment(payment.status) || payment.amount <= 0) continue;
    if (isRegistrationFeePayment(payment.description)) registrationPaid.add(payment.studentId);
    const seen = firstPaid.get(payment.studentId);
    if (!seen || payment.createdAt < seen) firstPaid.set(payment.studentId, payment.createdAt);
  }

  const rows: SeatRow[] = [];
  for (const student of students) {
    const upcoming = waiting.get(student.id);
    if (!upcoming) continue;
    const access = accessFromStudent(student);
    const hasReg = registrationPaid.has(student.id);
    const seat = seatStatusFor({
      tuitionPaid: access.totalPaid,
      registrationPaid: hasReg,
      depositPaid: access.outstanding <= 0,
      fullyPaid: access.outstandingBalance <= 0,
    });
    rows.push({
      studentId: student.id,
      userId: student.user?.id ?? null,
      name: student.user?.name ?? "Unnamed",
      email: student.user?.email ?? "",
      phone: phoneOf(student.admission),
      branchId: student.branchId ?? null,
      branch: student.branch?.name ?? "Unassigned",
      level: student.level,
      sessionSlot: student.sessionSlot,
      classType: student.classType,
      createdAt: student.createdAt instanceof Date ? student.createdAt.toISOString() : String(student.createdAt),
      batch: upcoming.batch,
      batchLabel: upcoming.monthLabel,
      startsOn: upcoming.startsOn.toISOString(),
      daysUntilStart: upcoming.daysUntilStart,
      seat,
      tuitionPaid: access.totalPaid,
      registrationPaid: hasReg,
      tuitionFee: access.tuitionFee,
      requiredDeposit: access.requiredDeposit,
      depositOutstanding: access.outstanding,
      balanceOutstanding: access.outstandingBalance,
      firstPaidAt: firstPaid.get(student.id)?.toISOString() ?? null,
      seatNumber: null,
    });
  }

  // "You were the 7th learner to secure an October seat" — ranked within the
  // intake by when each person first put money down.
  const byBatch = new Map<string, SeatRow[]>();
  for (const row of rows) {
    const list = byBatch.get(row.batchLabel) ?? [];
    list.push(row);
    byBatch.set(row.batchLabel, list);
  }
  for (const list of byBatch.values()) {
    list
      .filter((row) => row.firstPaidAt)
      .sort((a, b) => (a.firstPaidAt as string).localeCompare(b.firstPaidAt as string))
      .forEach((row, index) => {
        row.seatNumber = index + 1;
      });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export type IntakeSummary = {
  batchLabel: string;
  startsOn: string;
  daysUntilStart: number;
  total: number;
  /** Learners who have put any money down — the seats "taken". */
  secured: number;
  bySeat: Record<SeatStatus, number>;
  tuitionCollected: number;
  balanceOutstanding: number;
};

export function summariseIntakes(rows: SeatRow[]): IntakeSummary[] {
  const map = new Map<string, IntakeSummary>();
  for (const row of rows) {
    const existing =
      map.get(row.batchLabel) ??
      ({
        batchLabel: row.batchLabel,
        startsOn: row.startsOn,
        daysUntilStart: row.daysUntilStart,
        total: 0,
        secured: 0,
        bySeat: { paid_in_full: 0, deposit_paid: 0, registration_only: 0, unpaid: 0 },
        tuitionCollected: 0,
        balanceOutstanding: 0,
      } satisfies IntakeSummary);
    existing.total += 1;
    if (row.seat !== "unpaid") existing.secured += 1;
    existing.bySeat[row.seat] += 1;
    existing.tuitionCollected += row.tuitionPaid;
    existing.balanceOutstanding += row.balanceOutstanding;
    map.set(row.batchLabel, existing);
  }
  return [...map.values()].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}
