import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import crypto from "crypto";

/**
 * Exam candidates.
 *
 * Someone from the public who books an ÖSD sitting gets a real account so they
 * can come back and see their booking, seat number, result and certificate.
 * They are NOT students: no classes, materials, community, assignments or
 * payments.
 *
 * That distinction is carried by Role.CANDIDATE plus the absence of a Student
 * row. Every student feature already resolves the signed-in user to a Student
 * record, so a candidate is naturally excluded rather than needing a new check
 * bolted onto each page — provided nothing silently creates a Student for
 * them, which is what `mayAutoCreateStudent` guards.
 */

export const CANDIDATE_ROLE = "CANDIDATE";

export function isCandidateRole(role: unknown) {
  return String(role ?? "").toUpperCase() === CANDIDATE_ROLE;
}

/**
 * Several routes create a Student row on demand for a signed-in user. That is
 * right for a student whose record is missing, and wrong for a candidate — it
 * would quietly promote them into the full portal. Call this first.
 */
export async function mayAutoCreateStudent(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return !isCandidateRole(user?.role);
}

/** One-time token for setting a password on a freshly created account. */
export function claimToken(email: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? "easyway-dev-secret";
  return crypto.createHmac("sha256", secret).update(`claim:${email.toLowerCase()}`).digest("hex").slice(0, 40);
}

export function verifyClaimToken(email: string, token: string): boolean {
  const expected = claimToken(email);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export function claimUrl(email: string): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}/candidate/claim?email=${encodeURIComponent(email)}&token=${claimToken(email)}`;
}

export type EnsureCandidateResult = {
  userId: string;
  created: boolean;
  /** Only present when the account was just created and has no password yet. */
  claimUrl?: string;
};

/**
 * Find or create the account behind an external exam registration.
 *
 * An existing account of ANY role is reused — if a former student books an ÖSD
 * sitting with the email they already have here, that is the same person and
 * they should not end up with two logins.
 */
export async function ensureCandidateAccount(input: {
  email: string;
  name?: string | null;
}): Promise<EnsureCandidateResult> {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { userId: existing.id, created: false };

  // A password they never learn. They set a real one through the claim link;
  // until then the account cannot be signed into, which is the point.
  const unusable = await bcryptjs.hash(crypto.randomBytes(32).toString("hex"), 10);

  const user = await prisma.user.create({
    data: {
      email,
      name: input.name?.trim() || email.split("@")[0],
      password: unusable,
      role: CANDIDATE_ROLE as any,
      // Unclaimed until they set their own password through the link.
      passwordClaimed: false,
    },
    select: { id: true },
  });

  return { userId: user.id, created: true, claimUrl: claimUrl(email) };
}

export type MyExam = {
  registrationId: string;
  examId: string | null;
  name: string;
  examBody: string | null;
  level: string | null;
  examDate: string;
  status: string;
  paymentStatus: string;
  fee: number | null;
  seatNumber: string | null;
  branchName: string | null;
  isPast: boolean;
  result: { score: number; grade: string | null; feedback: string | null } | null;
};

/**
 * Every exam this account is registered for — internal Easyway tests and
 * centre sittings alike, in one list, for students and candidates both.
 */
export async function myExams(userId: string, now = new Date()): Promise<MyExam[]> {
  const student = await prisma.student.findUnique({
    where: { userId },
    select: { id: true },
  });

  const registrations = await prisma.examRegistration.findMany({
    where: {
      status: { not: "cancelled" },
      // Match on the owner, and on the Student for rows predating that field.
      OR: [{ userId }, ...(student ? [{ studentId: student.id }] : [])],
    },
    orderBy: { examDate: "asc" },
    include: {
      exam: {
        select: {
          id: true, examBody: true, level: true, fee: true,
          branch: { select: { name: true } },
        },
      },
    },
  });

  // Results are attached per exam, and only students have graded results.
  const grades = student
    ? await prisma.grade.findMany({
        where: { studentId: student.id, examId: { not: null } },
        select: { examId: true, score: true, grade: true, feedback: true },
      })
    : [];
  const gradeBy = new Map(grades.map((g) => [g.examId!, g]));

  return registrations.map((r) => {
    const grade = r.examId ? gradeBy.get(r.examId) : undefined;
    return {
      registrationId: r.id,
      examId: r.examId,
      name: r.examName,
      examBody: r.exam?.examBody ?? null,
      level: r.exam?.level ?? null,
      examDate: r.examDate.toISOString(),
      status: r.status,
      paymentStatus: r.paymentStatus,
      fee: r.exam?.fee ?? null,
      seatNumber: r.seatNumber,
      branchName: r.exam?.branch?.name ?? null,
      isPast: r.examDate < now,
      result: grade
        ? { score: grade.score, grade: grade.grade, feedback: grade.feedback }
        : null,
    };
  });
}
