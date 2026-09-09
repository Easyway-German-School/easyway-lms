import { Student, StudentProfile, User, Branch, Payment, Invoice, Lecturer } from "@prisma/client";

export type StudentWithUser = Student & {
  user: User;
  branch?: Branch | null;
  tutor?: Lecturer & { user: User } | null;
  // Extra tutors on an online / hybrid student — see lib/tutor-pairing.ts.
  coTutors?: Array<{ lecturerId: string; lecturer: Lecturer & { user: User } }>;
  payments?: Payment[];
  invoices?: Invoice[];
  profile?: StudentProfile | null;
  // _paymentSummary is returned by the admin API (totalPaid, totalInvoiced, balance)
  _paymentSummary?: { totalPaid: number; totalInvoiced: number; balance: number };
  // _segments is returned by the admin roster API — see lib/student-segments.ts
  _segments?: string[];
};
