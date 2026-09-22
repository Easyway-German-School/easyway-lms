/**
 * The server half of the portal witness.
 *
 * The student's shell reports what it put on screen (see lib/usePortalWitness.ts);
 * this recomputes what the portal SHOULD be doing to that student from the
 * database, compares the two with `judgeWitness`, and keeps the answer.
 *
 *  - `AccessSnapshot` — one row per student: the current verdict with its
 *    reasons, since when, and what their browser last said it rendered. This is
 *    what lets the office answer "why is this student locked?" without guessing,
 *    and see what the student is actually looking at rather than what the
 *    server thinks they are looking at.
 *  - a `drift` Incident when the two stories disagree.
 *
 * Nothing here can lock or unlock anybody. It observes; the gates themselves
 * are still `accessFromStudent` and the photo wall.
 */

import { prisma } from "@/lib/prisma";
import { hasProfilePhoto } from "@/lib/access";
import { accessFromStudent, STUDENT_ACCESS_SELECT } from "@/lib/student-access";
import { planStatusForStudent, planSuppressesLock } from "@/lib/payment-plans";
import { recordIncident } from "@/lib/incidents";
import {
  RENDERED_LOCKS,
  judgeWitness,
  portalVerdict,
  type PortalVerdict,
  type RenderedLock,
  type WitnessJudgement,
} from "@/lib/portal-verdict";

export type WitnessInput = {
  receivedLocks: string[];
  rendered: RenderedLock;
  computedAt: number;
  path: string;
};

const LOCK_CODES = new Set(["unpaid_deposit", "unsettled_balance", "upcoming_batch", "photo_missing"]);

/**
 * The body comes from a browser and is untrusted. Anything off-shape is
 * dropped rather than repaired — a witness that can be talked into writing
 * arbitrary text into an admin-facing table is worse than none.
 */
export function parseWitnessBody(body: unknown, now = Date.now()): WitnessInput | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.receivedLocks) || raw.receivedLocks.length > 4) return null;
  if (!raw.receivedLocks.every((code) => typeof code === "string" && LOCK_CODES.has(code))) return null;
  if (typeof raw.rendered !== "string" || !RENDERED_LOCKS.includes(raw.rendered as RenderedLock)) return null;
  const computedAt = Number(raw.computedAt);
  // A clock in the future, or a day in the past, is not a witness statement.
  if (!Number.isFinite(computedAt) || computedAt > now + 60_000 || computedAt < now - 86_400_000) return null;
  const path = typeof raw.path === "string" ? raw.path.split("?")[0].slice(0, 120) : "";
  return {
    receivedLocks: raw.receivedLocks as string[],
    rendered: raw.rendered as RenderedLock,
    computedAt,
    path,
  };
}

/** The verdict for one student right now, straight from the database. */
export async function currentPortalVerdict(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: STUDENT_ACCESS_SELECT,
  });
  if (!student) return null;
  const planStatus = await planStatusForStudent(studentId);
  const access = accessFromStudent(student, planSuppressesLock(planStatus?.adherence ?? null));
  const hasPhoto = hasProfilePhoto(student.admission);
  return { access, hasPhoto, verdict: portalVerdict(access, hasPhoto) };
}

export async function recordPortalWitness(
  userId: string,
  input: WitnessInput,
  now = Date.now(),
): Promise<{ recorded: boolean; judgement?: WitnessJudgement; verdict?: PortalVerdict }> {
  const student = await prisma.student.findUnique({
    where: { userId },
    // tenantId comes off STUDENT_ACCESS_SELECT now — declaring it again here
    // duplicates the key.
    select: { id: true, ...STUDENT_ACCESS_SELECT },
  });
  // An admin previewing, a tutor, a parent: nothing to witness.
  if (!student) return { recorded: false };

  const planStatus = await planStatusForStudent(student.id);
  const access = accessFromStudent(student, planSuppressesLock(planStatus?.adherence ?? null));
  const hasPhoto = hasProfilePhoto(student.admission);
  const verdict = portalVerdict(access, hasPhoto);
  const judgement = judgeWitness(input, verdict, now);

  const at = new Date(now);
  const existing = await prisma.accessSnapshot.findUnique({
    where: { studentId: student.id },
    select: { verdictKey: true },
  });
  const inputs = {
    hasAccess: access.hasAccess,
    lockReason: access.lockReason,
    hasPhoto,
    registrationPaid: access.registrationPaid,
    totalPaid: access.totalPaid,
    tuitionFee: access.tuitionFee,
    requiredDeposit: access.requiredDeposit,
    outstanding: access.outstanding,
    outstandingBalance: access.outstandingBalance,
    graceUntil: access.graceUntil,
    lockAt: access.lockAt,
    batchLocked: access.batchLocked,
    batch: access.batch,
  };
  const shared = {
    tenantId: student.tenantId ?? null,
    open: verdict.open,
    verdictKey: verdict.key,
    locks: verdict.locks as never,
    inputs: inputs as never,
    checkedAt: at,
    lastWitnessAt: at,
    lastWitnessRendered: input.rendered,
    lastWitnessPath: input.path || null,
  };
  await prisma.accessSnapshot.upsert({
    where: { studentId: student.id },
    create: { studentId: student.id, changedAt: at, ...shared },
    // changedAt moves only when the VERDICT does — that is what makes it "since when".
    update: { ...shared, ...(existing && existing.verdictKey === verdict.key ? {} : { changedAt: at }) },
  });

  if (judgement.kind !== "ok") {
    await recordIncident({
      kind: "drift",
      source: "invariant",
      route: `/portal-witness/${judgement.kind}`,
      message: judgement.detail,
      userId,
      tenantId: student.tenantId ?? null,
      context: {
        studentId: student.id,
        rendered: input.rendered,
        received: input.receivedLocks.join("+") || "open",
        database: verdict.key,
        path: input.path,
        ...(judgement.kind === "stale" ? { ageSeconds: judgement.ageSeconds } : {}),
      },
    });
  }

  return { recorded: true, judgement, verdict };
}
