import { Student, StudentProfile, User, Branch, Payment, Invoice, Lecturer } from "@prisma/client";

export type StudentWithUser = Student & {
  user: User;
  branch?: Branch | null;
  tutor?: Lecturer & { user: User } | null;
  payments?: Payment[];
  invoices?: Invoice[];
  profile?: StudentProfile | null;
  // _paymentSummary is returned by the admin API (totalPaid, totalInvoiced, balance)
  _paymentSummary?: { totalPaid: number; totalInvoiced: number; balance: number };
  // _segments is returned by the admin roster API — see lib/student-segments.ts
  _segments?: string[];
};
