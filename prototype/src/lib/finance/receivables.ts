import {
  DEPOSIT_RATE,
  isReceivedPayment,
  RECEIVED_PAYMENT_STATUSES,
  requiredDepositFor,
  tuitionFeeFor,
} from "@/lib/payment";

/**
 * ONE DEFINITION OF WHAT A STUDENT OWES.
 *
 * The admin dashboard says "7 students behind on tuition". Clicking that number
 * has to land on a page showing those seven students and no others — not seven
 * different students, not six, not a page that happens to be about payments.
 * That only holds if the count and the list are produced by the same code, so
 * this module is the only place the rule is written down and every caller reads
 * it from here:
 *
 *   /api/admin/overview            the dashboard count
 *   /api/admin/students            the roster the count links to
 *   /api/admin/finance             the accountant's headline figures
 *   /api/admin/finance/receivables the ageing report and its CSV
 *
 * Before this, the at-risk rule lived inline in the overview route and nowhere
 * else, so the destination page could not have reproduced it even in principle
 * — the "Behind on tuition" tile linked to an unfiltered payments screen and
 * left the reader to find the seven people themselves.
 *
 * MONEY IS WHOLE NAIRA throughout. `Payment.amount` is written in naira (the
 * Paystack boundary in src/lib/paystack-verify.ts divides kobo by 100 before
 * it is stored) and `tuitionFeeFor` quotes naira. Nothing here multiplies or
 * divides by 100, and nothing downstream should either.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long after enrolling a short deposit becomes a problem worth chasing.
 *
 * Two weeks: classes have started without them by then, so this is the point
 * where "not paid yet" turns into "attending without having paid".
 */
export const BEHIND_TUITION_MIN_DAYS = 14;

/* -------------------------------------------------------------------------- */
/* Cohorts                                                                    */
/* -------------------------------------------------------------------------- */

export const COHORTS = ["unpaid", "registered_only", "deposit_paid", "full_paid"] as const;
export type Cohort = (typeof COHORTS)[number];

export const COHORT_LABELS: Record<Cohort, string> = {
  unpaid: "Paid nothing",
  registered_only: "Registration only",
  deposit_paid: "Deposit paid",
  full_paid: "Paid in full",
};

/** Which cohorts the tuition paywall is showing a padlock to. */
export const LOCKED_OUT_COHORTS: Cohort[] = ["unpaid", "registered_only"];

/* -------------------------------------------------------------------------- */
/* Ageing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * AGED BY DAYS SINCE ENROLMENT, not by invoice due date.
 *
 * A conventional ageing report buckets by how long an invoice has been
 * overdue. That does not work here: tuition is owed from the day a student
 * enrols whether or not anybody raised an Invoice row, and most students who
 * have paid nothing have no invoice at all — they would age into "current"
 * forever and the report would show the school is owed nothing. Enrolment date
 * is the fact the school actually holds for every student, and it is the same
 * clock the "behind on tuition" rule already runs on, so the two agree.
 */
export const AGING_BUCKETS = [
  { id: "current", label: "Not yet chased", hint: "Under 14 days enrolled", from: 0, to: BEHIND_TUITION_MIN_DAYS - 1 },
  { id: "d14_30", label: "14–30 days", hint: "Classes have started", from: 14, to: 30 },
  { id: "d31_60", label: "31–60 days", hint: "A month behind", from: 31, to: 60 },
  { id: "d61_90", label: "61–90 days", hint: "Two months behind", from: 61, to: 90 },
  { id: "d90_plus", label: "Over 90 days", hint: "Escalate or write off", from: 91, to: Number.POSITIVE_INFINITY },
] as const;

export type AgingBucketId = (typeof AGING_BUCKETS)[number]["id"];

export function agingBucketFor(daysEnrolled: number): AgingBucketId {
  const bucket = AGING_BUCKETS.find((b) => daysEnrolled >= b.from && daysEnrolled <= b.to);
  return (bucket ?? AGING_BUCKETS[0]).id;
}

/* -------------------------------------------------------------------------- */
/* Input and output shapes                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What every caller must load. Exported as a Prisma `select` so the four routes
 * cannot drift into loading different fields and computing different answers —
 * a caller that forgets `branch` would silently price every Abuja student at
 * the standard tier, which is the exact bug `tuitionFeeFor` was built to stop.
 */
export const FINANCE_STUDENT_SELECT = {
  id: true,
  level: true,
  status: true,
  classType: true,
  createdAt: true,
  branch: { select: { id: true, name: true } },
  user: { select: { name: true, email: true } },
  payments: {
    where: { status: { in: RECEIVED_PAYMENT_STATUSES } },
    select: { amount: true, createdAt: true, method: true },
  },
} as const;

export type FinanceStudentInput = {
  id: string;
  level: string;
  status?: string | null;
  classType?: string | null;
  createdAt: Date;
  branch?: { id: string; name: string } | null;
  user?: { name?: string | null; email?: string | null } | null;
  payments: Array<{ amount: number; status?: string | null; createdAt?: Date; method?: string | null }>;
};

export type StudentFinance = {
  id: string;
  name: string;
  email: string;
  level: string;
  status: string;
  classType: string;
  branchId: string | null;
  branch: string;

  tuitionFee: number;
  requiredDeposit: number;
  paid: number;
  /** Against the full fee — what the school is still owed in total. */
  owed: number;
  /** Against the deposit only — what unlocks their classes. The chase figure. */
  owedOnDeposit: number;
  progressPercent: number;

  cohort: Cohort;
  depositPaid: boolean;
  fullPaid: boolean;
  lockedOut: boolean;

  daysEnrolled: number;
  behindOnTuition: boolean;
  agingBucket: AgingBucketId;
  lastPaymentAt: string | null;
  paymentCount: number;
};

/* -------------------------------------------------------------------------- */
/* The computation                                                            */
/* -------------------------------------------------------------------------- */

export function computeStudentFinance(student: FinanceStudentInput, now: Date = new Date()): StudentFinance {
  const feeLookup = {
    level: student.level,
    branch: student.branch?.name ?? null,
    classType: student.classType,
  };
  const tuitionFee = tuitionFeeFor(feeLookup);
  const requiredDeposit = requiredDepositFor(feeLookup);

  /**
   * Defensive filter on `status`. `FINANCE_STUDENT_SELECT` already narrows to
   * received payments (completed + partial deposits), but a caller passing its
   * own shape must not be able to count a pending or failed transaction as
   * money in the bank — that is the difference between an accurate collection
   * rate and an optimistic one.
   */
  const received = student.payments.filter(
    (payment) => payment.status == null || isReceivedPayment(payment.status),
  );
  const paid = received.reduce((sum, payment) => sum + (payment.amount || 0), 0);

  const fullPaid = paid >= tuitionFee;
  const depositPaid = paid >= requiredDeposit;

  const cohort: Cohort = paid <= 0 ? "unpaid" : fullPaid ? "full_paid" : depositPaid ? "deposit_paid" : "registered_only";

  const daysEnrolled = Math.max(0, Math.floor((now.getTime() - student.createdAt.getTime()) / DAY_MS));

  const lastPaymentAt = received.reduce<Date | null>((latest, payment) => {
    if (!payment.createdAt) return latest;
    return !latest || payment.createdAt > latest ? payment.createdAt : latest;
  }, null);

  return {
    id: student.id,
    name: student.user?.name ?? "Unnamed",
    email: student.user?.email ?? "",
    level: student.level,
    status: student.status ?? "active",
    classType: student.classType ?? "group",
    branchId: student.branch?.id ?? null,
    branch: student.branch?.name ?? "Unassigned",

    tuitionFee,
    requiredDeposit,
    paid,
    owed: Math.max(0, tuitionFee - paid),
    owedOnDeposit: Math.max(0, requiredDeposit - paid),
    progressPercent: tuitionFee > 0 ? Math.min(100, Math.round((paid / tuitionFee) * 100)) : 0,

    cohort,
    depositPaid,
    fullPaid,
    lockedOut: LOCKED_OUT_COHORTS.includes(cohort),

    daysEnrolled,
    behindOnTuition: !depositPaid && daysEnrolled >= BEHIND_TUITION_MIN_DAYS,
    agingBucket: agingBucketFor(daysEnrolled),
    lastPaymentAt: lastPaymentAt?.toISOString() ?? null,
    paymentCount: received.length,
  };
}

export function computeAll(students: FinanceStudentInput[], now: Date = new Date()): StudentFinance[] {
  return students.map((student) => computeStudentFinance(student, now));
}

/* -------------------------------------------------------------------------- */
/* Focus presets — the contract between a dashboard tile and its destination  */
/* -------------------------------------------------------------------------- */

/**
 * Every clickable figure on the admin dashboard names one of these, and the
 * students API filters by the same name. That is what makes the promise
 * "clicking 7 shows you those 7" structural rather than a coincidence that
 * survives until somebody edits one of the two places.
 *
 * `label` is what the destination page prints in its focus banner, so the
 * reader is told which subset they are looking at and why — a filtered roster
 * with no explanation is indistinguishable from a broken one.
 */
export type FocusContext = {
  now: Date;
  startOfMonth: Date;
};

export type FocusPreset = {
  id: string;
  /** Printed in the banner on the destination page. */
  label: string;
  /** The rule, in words, for the person reading the filtered list. */
  hint: string;
  /** Highlight colour for matched rows. */
  tone: "danger" | "warn" | "good" | "info";
  matches: (row: StudentFinance, context: FocusContext, raw: FinanceStudentInput) => boolean;
};

export const FOCUS_PRESETS: Record<string, FocusPreset> = {
  behind_tuition: {
    id: "behind_tuition",
    label: "Behind on tuition",
    hint: `Enrolled ${BEHIND_TUITION_MIN_DAYS}+ days and still short of the ${Math.round(DEPOSIT_RATE * 100)}% deposit`,
    tone: "danger",
    matches: (row) => row.behindOnTuition,
  },
  locked_out: {
    id: "locked_out",
    label: "Behind the paywall",
    hint: "Cannot reach classes yet — deposit unpaid",
    tone: "danger",
    matches: (row) => row.lockedOut,
  },
  unpaid: {
    id: "unpaid",
    label: COHORT_LABELS.unpaid,
    hint: "No completed payment of any kind",
    tone: "danger",
    matches: (row) => row.cohort === "unpaid",
  },
  registered_only: {
    id: "registered_only",
    label: COHORT_LABELS.registered_only,
    hint: "Paid something, still under the deposit",
    tone: "warn",
    matches: (row) => row.cohort === "registered_only",
  },
  deposit_paid: {
    id: "deposit_paid",
    label: COHORT_LABELS.deposit_paid,
    hint: "Classes unlocked, balance still outstanding",
    tone: "info",
    matches: (row) => row.cohort === "deposit_paid",
  },
  full_paid: {
    id: "full_paid",
    label: COHORT_LABELS.full_paid,
    hint: "Nothing outstanding",
    tone: "good",
    matches: (row) => row.cohort === "full_paid",
  },
  owing: {
    id: "owing",
    label: "Any balance outstanding",
    hint: "Owes something against the full fee",
    tone: "warn",
    matches: (row) => row.owed > 0,
  },
  new_this_month: {
    id: "new_this_month",
    label: "Enrolled this month",
    hint: "Joined since the 1st",
    tone: "good",
    matches: (_row, context, raw) => raw.createdAt >= context.startOfMonth,
  },
  private: {
    id: "private",
    label: "Private students",
    hint: "One-to-one tuition",
    tone: "info",
    matches: (row) => row.classType === "private",
  },
  active: {
    id: "active",
    label: "Active students",
    hint: "Status is active",
    tone: "good",
    matches: (row) => row.status === "active",
  },
};

export function focusPreset(id: string | null | undefined): FocusPreset | null {
  if (!id) return null;
  return FOCUS_PRESETS[id] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Rollups                                                                    */
/* -------------------------------------------------------------------------- */

export type ReceivablesSummary = ReturnType<typeof summariseReceivables>;

export function summariseReceivables(rows: StudentFinance[]) {
  const expected = rows.reduce((sum, row) => sum + row.tuitionFee, 0);
  const collected = rows.reduce((sum, row) => sum + row.paid, 0);
  const outstanding = rows.reduce((sum, row) => sum + row.owed, 0);
  const depositShortfall = rows.reduce((sum, row) => sum + row.owedOnDeposit, 0);

  const cohortCounts = COHORTS.reduce<Record<Cohort, number>>(
    (acc, cohort) => {
      acc[cohort] = rows.filter((row) => row.cohort === cohort).length;
      return acc;
    },
    { unpaid: 0, registered_only: 0, deposit_paid: 0, full_paid: 0 },
  );

  const aging = AGING_BUCKETS.map((bucket) => {
    // Only unsettled students appear in an ageing report. Someone who paid in
    // full ninety days ago is not ninety days overdue, and counting them would
    // make the oldest bucket grow every term regardless of collections.
    const inBucket = rows.filter((row) => row.owed > 0 && row.agingBucket === bucket.id);
    return {
      id: bucket.id,
      label: bucket.label,
      hint: bucket.hint,
      students: inBucket.length,
      amount: inBucket.reduce((sum, row) => sum + row.owed, 0),
      depositShortfall: inBucket.reduce((sum, row) => sum + row.owedOnDeposit, 0),
    };
  });

  const byBranch = groupRollup(rows, (row) => row.branchId ?? "unassigned", (row) => row.branch);
  const byLevel = groupRollup(rows, (row) => row.level, (row) => row.level);

  return {
    students: rows.length,
    expected,
    collected,
    outstanding,
    depositShortfall,
    collectionRate: expected > 0 ? Math.round((collected / expected) * 100) : 0,
    cohortCounts,
    lockedOut: rows.filter((row) => row.lockedOut).length,
    behindOnTuition: rows.filter((row) => row.behindOnTuition).length,
    aging,
    byBranch,
    byLevel,
  };
}

function groupRollup(
  rows: StudentFinance[],
  keyOf: (row: StudentFinance) => string,
  labelOf: (row: StudentFinance) => string,
) {
  const groups = new Map<string, { key: string; name: string; students: number; expected: number; collected: number; outstanding: number }>();

  for (const row of rows) {
    const key = keyOf(row);
    const entry = groups.get(key) ?? { key, name: labelOf(row), students: 0, expected: 0, collected: 0, outstanding: 0 };
    entry.students += 1;
    entry.expected += row.tuitionFee;
    entry.collected += row.paid;
    entry.outstanding += row.owed;
    groups.set(key, entry);
  }

  return [...groups.values()]
    .map((entry) => ({
      ...entry,
      collectionRate: entry.expected > 0 ? Math.round((entry.collected / entry.expected) * 100) : 0,
    }))
    .sort((a, b) => b.outstanding - a.outstanding);
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/** Full precision, for tables and exports where the exact figure matters. */
export function naira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString("en-NG")}`;
}

/** Abbreviated, for headline tiles where the shape matters more than the digits. */
export function nairaShort(amount: number): string {
  const value = Math.round(amount);
  if (Math.abs(value) >= 1_000_000) return `₦${(value / 1_000_000).toFixed(1)}m`;
  if (Math.abs(value) >= 1_000) return `₦${(value / 1_000).toFixed(0)}k`;
  return `₦${value.toLocaleString("en-NG")}`;
}
