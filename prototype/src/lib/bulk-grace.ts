import { batchFromAdmission, MONTH_NAMES, monthNameToIndex, resolveBatchWindow } from "@/lib/batch";

export const BULK_GRACE_PAYMENT_STATUSES = [
  "all",
  "unpaid",
  "outstanding",
  "part_paid",
  "deposit_paid",
  "paid",
] as const;

export type BulkGracePaymentStatus = (typeof BULK_GRACE_PAYMENT_STATUSES)[number];

function normalizeBatchLabel(
  batch: unknown,
  year: unknown,
  registeredAt?: Date,
): string | null {
  if (typeof batch !== "string" || !batch.trim()) return null;
  const value = batch.trim();
  const embeddedYears = value.match(/\b\d{4}\b/g);
  const month = value.replace(/(?:\s+\d{4})+$/, "").trim();
  const monthIndex = monthNameToIndex(month);
  if (monthIndex === null) return null;

  const batchYear = typeof year === "number" && Number.isInteger(year) && year >= 1900 && year <= 9999
    ? year
    : embeddedYears?.length
      ? Number(embeddedYears[embeddedYears.length - 1])
      : resolveBatchWindow(month, { registeredAt })?.year;
  return batchYear ? `${MONTH_NAMES[monthIndex]} ${batchYear}` : MONTH_NAMES[monthIndex];
}

export function bulkGraceBatchLabel(student: {
  admission: unknown;
  enrolments: Array<{ batchMonth: string | null; batchYear: number | null; outcome: string }>;
  createdAt?: Date;
}): string | null {
  const current = student.enrolments.find((enrolment) => enrolment.outcome === "ongoing");
  if (current?.batchMonth) {
    return normalizeBatchLabel(current.batchMonth, current.batchYear, student.createdAt);
  }
  const admissionBatch = batchFromAdmission(student.admission);
  const admissionYear = student.admission && typeof student.admission === "object"
    ? (student.admission as Record<string, unknown>).batchYear
    : undefined;
  return normalizeBatchLabel(admissionBatch, admissionYear, student.createdAt);
}

export function compareBulkGraceBatchLabels(first: string, second: string): number {
  const parse = (label: string) => {
    const match = label.match(/^(.+?)\s+(\d{4})$/);
    const monthIndex = monthNameToIndex(match?.[1] ?? label);
    return {
      year: match ? Number(match[2]) : 0,
      month: monthIndex ?? -1,
    };
  };
  const a = parse(first);
  const b = parse(second);
  return b.year - a.year || b.month - a.month || first.localeCompare(second);
}

export function matchesBulkGraceBatch(selectedBatch: string, studentBatch: string | null): boolean {
  return !selectedBatch || studentBatch === selectedBatch;
}

export function matchesBulkGracePaymentStatus(
  status: BulkGracePaymentStatus,
  student: {
    paid: number;
    owed: number;
    currentLevelOutstanding: number;
    depositPaid: boolean;
  },
): boolean {
  switch (status) {
    case "all":
      return true;
    case "unpaid":
      return student.paid <= 0;
    case "outstanding":
      return student.owed > 0;
    case "part_paid":
      return student.paid > 0 && student.owed > 0;
    case "deposit_paid":
      return student.depositPaid && student.currentLevelOutstanding > 0;
    case "paid":
      return student.paid > 0 && student.owed <= 0;
  }
}
