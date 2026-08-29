/**
 * What a record looks like on the way out of the public API.
 *
 * Written once, here, rather than inline in each route. Two reasons, and the
 * second is the important one:
 *
 *  1. A list endpoint and a detail endpoint that disagree about the shape of a
 *     student is the kind of inconsistency a partner discovers in production.
 *  2. **It is an allowlist.** Handing Prisma rows straight out means every
 *     column added later is published the moment it is added — so the next
 *     person to store a medical note, a guardian's phone number or an internal
 *     grading comment on Student has silently exposed it to every integrator
 *     holding a `students:read` key. Naming the fields makes disclosure a
 *     decision somebody makes rather than a side effect of a migration.
 *
 * `tenantId` is never included. A partner can only ever see their own tenant's
 * rows, so it carries no information they do not have, and publishing an
 * internal identifier invites somebody to try passing a different one.
 */

type Nullable<T> = T | null;

export type PublicStudent = ReturnType<typeof publicStudent>;

export function publicStudent(row: {
  id: string;
  studentCode: Nullable<string>;
  status: string;
  level: string;
  sessionSlot: string;
  classType: string;
  deliveryMode: string;
  pathway: string;
  createdAt?: Date;
  graduationDate: Nullable<Date>;
  branch?: Nullable<{ id: string; name: string }>;
  user?: Nullable<{ name: Nullable<string>; email: string }>;
}) {
  return {
    id: row.id,
    studentCode: row.studentCode,
    name: row.user?.name ?? null,
    email: row.user?.email ?? null,
    status: row.status,
    level: row.level,
    sessionSlot: row.sessionSlot,
    classType: row.classType,
    deliveryMode: row.deliveryMode,
    pathway: row.pathway,
    branch: row.branch ? { id: row.branch.id, name: row.branch.name } : null,
    graduatedAt: row.graduationDate?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString() ?? null,
  };
}

export const studentSelect = {
  id: true,
  studentCode: true,
  status: true,
  level: true,
  sessionSlot: true,
  classType: true,
  deliveryMode: true,
  pathway: true,
  graduationDate: true,
  createdAt: true,
  branch: { select: { id: true, name: true } },
  user: { select: { name: true, email: true } },
} as const;

export function publicPayment(row: {
  id: string;
  amount: number;
  currency: Nullable<string>;
  status: string;
  method: Nullable<string>;
  description: Nullable<string>;
  createdAt: Date;
  studentId: Nullable<string>;
}) {
  return {
    id: row.id,
    studentId: row.studentId,
    /**
     * Naira, not kobo, because that is the unit this column holds — the school's
     * tuition ledger has always been whole naira. The platform's OWN billing is
     * in kobo, and the two must not be confused, which is why the field names
     * differ (`amount` here, `amountKobo` there) rather than sharing a name and
     * a different scale.
     */
    amount: row.amount,
    currency: row.currency ?? "NGN",
    status: row.status,
    method: row.method,
    description: row.description,
    paidAt: row.createdAt.toISOString(),
  };
}

export const paymentSelect = {
  id: true,
  amount: true,
  currency: true,
  status: true,
  method: true,
  description: true,
  createdAt: true,
  studentId: true,
} as const;

export function publicClass(row: {
  id: string;
  name: string;
  description: Nullable<string>;
  schedule: Nullable<string>;
  createdAt: Date;
  course?: Nullable<{ id: string; title: string; level: Nullable<string> }>;
  lecturer?: Nullable<{ id: string; user: Nullable<{ name: Nullable<string> }> }>;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    /**
     * Passed through as the string it is stored as. It holds JSON in some rows
     * and free text in others, and parsing it here would mean the API sometimes
     * returns an object and sometimes a string for the same field — worse for a
     * partner than a value that is consistently opaque.
     */
    schedule: row.schedule,
    course: row.course ? { id: row.course.id, title: row.course.title, level: row.course.level } : null,
    tutor: row.lecturer ? { id: row.lecturer.id, name: row.lecturer.user?.name ?? null } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const classSelect = {
  id: true,
  name: true,
  description: true,
  schedule: true,
  createdAt: true,
  course: { select: { id: true, title: true, level: true } },
  lecturer: { select: { id: true, user: { select: { name: true } } } },
} as const;

export function publicAttendance(row: {
  id: string;
  studentId: string;
  classId: Nullable<string>;
  status: string;
  present: boolean;
  date: Date;
  notes?: Nullable<string>;
}) {
  return {
    id: row.id,
    studentId: row.studentId,
    classId: row.classId,
    status: row.status,
    present: row.present,
    date: row.date.toISOString(),
    /**
     * Notes are included because they are the register's own remarks — "late,
     * bus" — which is what an integrator building a parent app needs. They are
     * NOT free-text staff commentary about a student, which lives elsewhere and
     * is deliberately not published.
     */
    notes: row.notes ?? null,
  };
}

export const attendanceSelect = {
  id: true,
  studentId: true,
  classId: true,
  status: true,
  present: true,
  date: true,
  notes: true,
} as const;
