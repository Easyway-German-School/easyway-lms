import { Student, User, Branch, Payment, Invoice, Lecturer } from "@prisma/client";

export type StudentWithUser = Student & {
  user: User;
  branch?: Branch | null;
  tutor?: Lecturer & { user: User } | null;
  payments?: Payment[];
  invoices?: Invoice[];
  // _paymentSummary is returned by the admin API (totalPaid, totalInvoiced, balance)
  _paymentSummary?: { totalPaid: number; totalInvoiced: number; balance: number };
};
