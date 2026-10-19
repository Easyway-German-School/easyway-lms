import { batchFromAdmission } from "@/lib/batch";

export const BULK_GRACE_PAYMENT_STATUSES = [
  "all",
  "unpaid",
  "outstanding",
  "part_paid",
  "deposit_paid",
  "paid",
] as const;

export type BulkGracePaymentStatus = (typeof BULK_GRACE_PAYMENT_STATUSES)[number];

export function bulkGraceBatchLabel(student: {
  admission: unknown;
  enrolments: Array<{ batchMonth: string | null; batchYear: number | null; outcome: string }>;
}): string | null {
  const current = student.enrolments.find((enrolment) => enrolment.outcome === "ongoing");
  if (current?.batchMonth) {
    return current.batchYear ? `${current.batchMonth} ${current.batchYear}` : current.batchMonth;
  }
  return batchFromAdmission(student.admission);
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
