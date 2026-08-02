import { randomBytes } from "crypto";

import { prisma } from "@/lib/prisma";
import { awardFor, hasPassed, type Award } from "@/lib/grading";
import { SESSION_MONTHS } from "@/lib/levels";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { resolveBatchWindow } from "@/lib/batch";

/**
 * Certificates.
 *
 * Everyone who sits a session gets one at the end of the two months. Passing
 * decides the KIND, never whether a document exists:
 *
 *   achievement  reached the pass mark — "Certificate of Achievement",
 *                banded Distinction / Merit / Pass
 *   completion   attended but did not reach it — "Certificate of Completion",
 *                which records the level studied and the session attended
 *
 * Nothing on either document says "failed". A student who put eight weeks in
 * and missed the mark has still completed a course of study, and a school that
 * hands them nothing loses them to the competitor who would have.
 *
 * The PROVISIONAL stamp is the one lever tuition has over the document, and it
 * is computed from the LIVE balance every time the certificate is rendered —
 * never frozen at issue. A student who clears their balance in month three gets
 * a clean certificate on the next reload, which is exactly the incentive the
 * pay-in-full offer promises. See `src/lib/pay-in-full.ts`.
 */

export type CertificateKind = "achievement" | "completion";

export const CERTIFICATE_TITLES: Record<CertificateKind, string> = {
  achievement: "Certificate of Achievement",
  completion: "Certificate of Completion",
};

/** How the student's result is described in the body copy. */
export function citationFor(kind: CertificateKind, level: string, award: Award): string {
  if (kind === "achievement") {
    const suffix = award === "pass" ? "" : ` ${award === "distinction" ? "with Distinction" : "with Merit"}`;
    return `has satisfied the examiners in the ${level} course of German language study and is awarded this certificate${suffix}.`;
  }
  return `has completed the ${level} course of German language study, having attended and participated throughout the session.`;
}

/**
 * Whether this student's session is over.
 *
 * Derived from the batch month on the admission payload, the same way the
 * timetable generator and the promotion report derive it. Deriving it a fourth
 * way would let the certificate disagree with the calendar about whether
 * classes have finished.
 */
/**
 * The two dates a certificate states: when this student started the level and
 * when they finished it.
 *
 * Derived from the batch month and SESSION_MONTHS — the same pair the
 * timetable, the promotion report and `sessionIsComplete` all derive from, so
 * the certificate cannot disagree with the calendar about when the course ran.
 *
 * The start is the first of the batch month; the end is the last day of the
 * month the session finishes in. Returns nulls for a student with no batch
 * recorded, and the document then omits the line rather than printing a guess.
 */
export function courseWindow(
  batch: string | null,
  now = new Date(),
  registeredAt: Date | null = null,
): { start: Date | null; end: Date | null } {
  const window = resolveBatchWindow(batch, { registeredAt, now });
  if (!window) return { start: null, end: null };
  return { start: window.startsOn, end: window.endsOn };
}

export function sessionIsComplete(
  batch: string | null,
  now = new Date(),
  registeredAt: Date | null = null,
): boolean {
  const window = resolveBatchWindow(batch, { registeredAt, now });
  if (!window) return false;
  return window.monthsElapsed >= SESSION_MONTHS;
}

export type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * Two conditions, both about whether there is anything to certify.
 *
 * The deposit matters because a registration-only student never started class —
 * certifying them would put the school's name to eight weeks that did not
 * happen. It is NOT a payment gate on the full fee: a student who deposited and
 * still owes the balance gets their certificate, stamped provisional.
 */
export function certificateEligibility(input: {
  batch: string | null;
  totalPaid: number;
  requiredDeposit: number;
  now?: Date;
  /** When the student registered — decides which occurrence of the batch month. */
  registeredAt?: Date | null;
}): Eligibility {
  if (!sessionIsComplete(input.batch, input.now, input.registeredAt ?? null)) {
    return {
      eligible: false,
      reason: `Your ${SESSION_MONTHS}-month session is still running. Certificates are issued at the end of it.`,
    };
  }
  if (input.totalPaid < input.requiredDeposit) {
    return {
      eligible: false,
      reason: "Certificates are issued to students who started classes. Please pay your tuition deposit first.",
    };
  }
  return { eligible: true };
}

/**
 * A short, unguessable verification code.
 *
 * The serial counts up and is meant to be readable, which also makes it
 * guessable — anyone could walk the sequence and read every student's result
 * off the public verify page. The code is what /verify actually accepts.
 * Ambiguous characters are left out so a code copied off a printed certificate
 * by hand still resolves.
 */
function makeVerifyCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let code = "";
  for (let i = 0; i < 10; i++) {
    code += alphabet[bytes[i] % alphabet.length];
    if (i === 4) code += "-";
  }
  return code;
}

/** EW/CERT/2026/A1/0007 — sequential within year and level. */
async function makeSerial(level: string, now: Date): Promise<string> {
  const year = now.getFullYear();
  const prefix = `EW/CERT/${year}/${level.toUpperCase()}/`;
  const issuedThisYear = await prisma.certificate.count({
    where: { level: level.toUpperCase(), serial: { startsWith: prefix } },
  });
  return `${prefix}${String(issuedThisYear + 1).padStart(4, "0")}`;
}

export type IssueResult =
  | { issued: true; certificateId: string; created: boolean }
  | { issued: false; reason: string };

/**
 * Issue this student's certificate for the level they are currently sitting.
 *
 * Idempotent: the unique index on (studentId, level) means re-running returns
 * the existing row instead of minting a second serial for the same course. That
 * matters because this runs on every visit to the certificates page — a student
 * refreshing must not spawn a numbered document each time.
 */
export async function issueCertificateForStudent(
  studentId: string,
  opts: { now?: Date } = {},
): Promise<IssueResult> {
  const now = opts.now ?? new Date();

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      level: true,
      classType: true,
      studentCode: true,
      admission: true,
      // Anchors which occurrence of the batch month this student's course ran
      // in — see lib/batch.ts.
      createdAt: true,
      user: { select: { name: true } },
      branch: { select: { name: true } },
      tutor: { select: { user: { select: { name: true } } } },
      grades: { select: { score: true } },
      payments: { where: { status: "completed" }, select: { amount: true } },
    },
  });

  if (!student) return { issued: false, reason: "Student not found" };

  const level = student.level.toUpperCase();
  const admission =
    typeof student.admission === "object" && student.admission !== null
      ? (student.admission as Record<string, unknown>)
      : {};
  const batch = typeof admission.batch === "string" && admission.batch.trim() ? admission.batch : null;

  const feeLookup = { level, branch: student.branch?.name ?? null, classType: student.classType };
  const totalPaid = student.payments.reduce((sum, payment) => sum + payment.amount, 0);

  const eligibility = certificateEligibility({
    batch,
    totalPaid,
    requiredDeposit: requiredDepositFor(feeLookup),
    now,
    registeredAt: student.createdAt,
  });
  if (!eligibility.eligible) return { issued: false, reason: eligibility.reason };

  const existing = await prisma.certificate.findUnique({
    where: { studentId_level: { studentId: student.id, level } },
    select: { id: true },
  });
  if (existing) return { issued: true, certificateId: existing.id, created: false };

  const averageScore = student.grades.length
    ? Math.round(student.grades.reduce((sum, grade) => sum + grade.score, 0) / student.grades.length)
    : null;
  const passed = hasPassed(averageScore);
  const award = awardFor(averageScore);

  const certificate = await prisma.certificate.create({
    data: {
      studentId: student.id,
      kind: passed ? "achievement" : "completion",
      level,
      award,
      serial: await makeSerial(level, now),
      verifyCode: makeVerifyCode(),
      averageScore,
      passed,
      studentName: student.user?.name ?? "Student",
      studentCode: student.studentCode,
      branchName: student.branch?.name ?? null,
      tutorName: student.tutor?.user?.name ?? null,
      batch,
      outstandingAtIssue: Math.max(0, tuitionFeeFor(feeLookup) - totalPaid),
      // Snapshotted like every other field here: a student who repeats the
      // level or moves batch must not change the dates on a document already
      // printed and in somebody's hand.
      courseStart: courseWindow(batch, now, student.createdAt).start,
      courseEnd: courseWindow(batch, now, student.createdAt).end,
      issuedAt: now,
    },
    select: { id: true },
  });

  return { issued: true, certificateId: certificate.id, created: true };
}

export type CertificateView = {
  id: string;
  kind: CertificateKind;
  title: string;
  level: string;
  award: Award;
  awardLabel: string;
  citation: string;
  serial: string;
  verifyCode: string;
  averageScore: number | null;
  passed: boolean;
  studentName: string;
  studentCode: string | null;
  branchName: string | null;
  tutorName: string | null;
  issuedAt: string;
  /** When the student started and finished this level. Null on old records. */
  courseStart: string | null;
  courseEnd: string | null;
  revoked: boolean;
  /** Live, not a snapshot — see the note at the top of this file. */
  provisional: boolean;
  outstanding: number;
};

/**
 * Shape a stored certificate for rendering, recomputing the provisional stamp
 * against what the student owes right now.
 */
export function toCertificateView(
  row: {
    id: string;
    kind: string;
    level: string;
    award: string;
    serial: string;
    verifyCode: string;
    averageScore: number | null;
    passed: boolean;
    studentName: string;
    studentCode: string | null;
    branchName: string | null;
    tutorName: string | null;
    issuedAt: Date;
    courseStart?: Date | null;
    courseEnd?: Date | null;
    revokedAt: Date | null;
  },
  liveOutstanding: number,
): CertificateView {
  const kind: CertificateKind = row.kind === "achievement" ? "achievement" : "completion";
  const award = row.award as Award;

  return {
    id: row.id,
    kind,
    title: CERTIFICATE_TITLES[kind],
    level: row.level,
    award,
    awardLabel:
      kind === "achievement"
        ? award === "distinction"
          ? "Distinction"
          : award === "merit"
          ? "Merit"
          : "Pass"
        : "Participation",
    citation: citationFor(kind, row.level, award),
    serial: row.serial,
    verifyCode: row.verifyCode,
    averageScore: row.averageScore,
    passed: row.passed,
    studentName: row.studentName,
    studentCode: row.studentCode,
    branchName: row.branchName,
    tutorName: row.tutorName,
    issuedAt: row.issuedAt.toISOString(),
    courseStart: row.courseStart?.toISOString() ?? null,
    courseEnd: row.courseEnd?.toISOString() ?? null,
    revoked: row.revokedAt !== null,
    provisional: liveOutstanding > 0,
    outstanding: Math.max(0, liveOutstanding),
  };
}
