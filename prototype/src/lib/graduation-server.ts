import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant/context";
import { notify } from "@/lib/notify";
import { batchFromAdmission } from "@/lib/batch";
import { buildLedger } from "@/lib/finance/ledger";
import { naira } from "@/lib/finance/receivables";
import { receivedPaymentFilter, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { nextLevelAfter } from "@/lib/levels";
import { completeLevelForStudents } from "@/lib/germany-journey-server";
import { issueCertificateForStudent } from "@/lib/certificates";
import { promoteStudents } from "@/lib/promotion";
import { readIntakeStartDayOverrides } from "@/lib/intake-server";
import type { IntakeStartDayOverrides } from "@/lib/intake";
import { resolveJourneyAudience } from "@/lib/next-level-journey";
import { markOffered, sendBeccaInvite } from "@/lib/next-level-manual-server";
import { writeNextLevelAuto } from "@/lib/next-level-pipeline-server";
import { findWronglyMoved, type WrongMove } from "@/lib/graduation-repair-server";
import {
  cohortTiming,
  graduationVerdict,
  nextPlacement,
  type CohortTiming,
  type GraduationVerdict,
  type NextPlacement,
} from "@/lib/graduation";

/**
 * The graduation desk — finishing a level in one place.
 *
 * Reads every active learner whose batch has finished (or finishes within the
 * lead window), groups them by branch · level · batch, says who can be moved on
 * and who cannot (and why), and does the moving in ONE safe order:
 *
 *   1. sign the level off        — the learner's map, stamp and journey event
 *   2. issue the certificate     — BEFORE the level changes: the issuer reads
 *                                  the learner's CURRENT level, so promoting
 *                                  first would lose the certificate for the
 *                                  level they just finished
 *   3. move them up              — new level, next intake, first-day date
 *                                  moved, new tuition charge (promoteStudents,
 *                                  placement "next-intake"); the portal locks
 *                                  on the new level's deposit / the intake
 *                                  countdown by itself
 *   4. tell them                 — Becca's next-level journey, the same one the
 *                                  pop on their dashboard shows: bell, push and
 *                                  a designed email with their own numbers and a
 *                                  Pay button that works
 *
 * A learner the desk calls "ready" is moved and told. One who only owes on the
 * level just finished ("fees") is NOT moved — the money rule stands — but is
 * still invited: the checkout bills that old balance and the new deposit in one
 * payment and signs the level off as it does, so they are never stuck waiting on
 * the office. Anyone who never started or was held back is left alone. The
 * verdict is recomputed on the server at click time — the browser's list is
 * never trusted.
 */

export const GRADUATION_AUTO_KEY = "graduation.auto";

export type DeskStudent = {
  studentId: string;
  name: string;
  email: string;
  sitting: string;
  verdict: GraduationVerdict;
  /** Already invited to the next level (the invitation went out, they have not moved yet). */
  offered: boolean;
  /** Everything received from them so far, and what is still to pay on the level they finished. */
  paid: number;
  balance: number;
};

export type DeskCohort = {
  key: string;
  branchId: string | null;
  branch: string;
  level: string;
  nextLevel: string | null;
  batch: string;
  label: string;
  weekend: boolean;
  endsOn: string;
  daysToEnd: number;
  ended: boolean;
  landing: { label: string; startsOn: string; hasStarted: boolean } | null;
  ready: number;
  /** Owe only on the level just finished: not moved, but invited. */
  owes: number;
  /** Never started or held back: left alone. */
  blocked: number;
  students: DeskStudent[];
};

export type RunningBatch = {
  key: string;
  branch: string;
  level: string;
  batch: string;
  label: string;
  endsOn: string;
  daysToEnd: number;
  count: number;
};

export type GraduationAuto = {
  enabled: boolean;
  lastRunAt: string | null;
  lastRunSummary: string | null;
};

export type GraduationDesk = {
  cohorts: DeskCohort[];
  running: RunningBatch[];
  accounting: DeskAccounting;
  /** Moved up in the last two weeks without having paid the deposit for the level they left. */
  wronglyMoved: WrongMove[];
  auto: GraduationAuto;
};

type Scanned = {
  studentId: string;
  name: string;
  email: string;
  branchId: string | null;
  branch: string;
  tutorId: string | null;
  /** The office has already invited this learner to the next level. */
  offered: boolean;
  paid: number;
  balance: number;
  level: string;
  batch: string;
  sessionSlot: string;
  classType: string | null;
  pathway: string | null;
  timing: CohortTiming;
  landing: NextPlacement | null;
  verdict: GraduationVerdict;
};

/** Where every active learner went: the answer to "I have 500, why are only 19 here?" */
export type DeskAccounting = {
  total: number;
  onDesk: number;
  running: number;
  notOpenYet: number;
  noBatch: number;
  topOfLadder: number;
};

type Scan = { candidates: Scanned[]; running: RunningBatch[]; accounting: DeskAccounting };

function readJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Who is due, and each learner's verdict. `where` is the caller's tenant /
 * branch fence; `ids` narrows to specific learners (the graduate action).
 */
async function scan(options: {
  where?: Record<string, unknown>;
  ids?: string[];
  now: Date;
  startDayOverrides: IntakeStartDayOverrides;
}): Promise<Scan> {
  const { now } = options;
  const students = await prisma.student.findMany({
    where: {
      status: "active",
      ...(options.where ?? {}),
      ...(options.ids ? { id: { in: options.ids } } : {}),
    },
    select: {
      id: true,
      level: true,
      sessionSlot: true,
      classType: true,
      pathway: true,
      admission: true,
      createdAt: true,
      classesStartedAt: true,
      heldBackAt: true,
      heldBackReason: true,
      branchId: true,
      tutorId: true,
      branch: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });

  const due: Array<{ student: (typeof students)[number]; batch: string; timing: CohortTiming }> = [];
  const runningMap = new Map<string, RunningBatch>();
  const accounting: DeskAccounting = { total: students.length, onDesk: 0, running: 0, notOpenYet: 0, noBatch: 0, topOfLadder: 0 };

  for (const student of students) {
    if (!nextLevelAfter(student.level)) {
      accounting.topOfLadder += 1;
      continue;
    }
    const batch = batchFromAdmission(student.admission);
    if (!batch) {
      accounting.noBatch += 1;
      continue;
    }
    const timing = cohortTiming({
      batch,
      sessionSlot: student.sessionSlot,
      registeredAt: student.createdAt,
      now,
    });
    if (!timing) {
      accounting.noBatch += 1;
      continue;
    }

    if (timing.graduatable) {
      accounting.onDesk += 1;
      due.push({ student, batch, timing });
    } else if (timing.startsOn.getTime() <= now.getTime()) {
      // Mid-course. Listed so the office can see what is coming, never actionable.
      accounting.running += 1;
      const key = `${student.branchId ?? "none"}|${student.level}|${batch}|${dayKey(timing.endsOn)}`;
      const seen = runningMap.get(key);
      if (seen) seen.count += 1;
      else
        runningMap.set(key, {
          key,
          branch: student.branch?.name ?? "Unassigned",
          level: student.level,
          batch,
          label: timing.label,
          endsOn: timing.endsOn.toISOString(),
          daysToEnd: timing.daysToEnd,
          count: 1,
        });
    } else {
      accounting.notOpenYet += 1;
    }
  }

  const running = [...runningMap.values()].sort((a, b) => a.daysToEnd - b.daysToEnd);
  if (due.length === 0) return { candidates: [], running, accounting };

  const ids = due.map((row) => row.student.id);
  const [attendance, charges, payments] = await Promise.all([
    prisma.attendance.groupBy({
      by: ["studentId"],
      where: { studentId: { in: ids }, status: { in: ["present", "late"] } },
      _count: { _all: true },
    }),
    prisma.tuitionCharge.findMany({
      where: { studentId: { in: ids }, deletedAt: null },
      select: {
        studentId: true,
        id: true,
        level: true,
        amount: true,
        waivedAmount: true,
        legacyArrears: true,
        createdAt: true,
        settledAt: true,
      },
    }),
    prisma.payment.findMany({
      where: { studentId: { in: ids }, deletedAt: null, ...receivedPaymentFilter() },
      select: { studentId: true, amount: true },
    }),
  ]);

  const attended = new Set(attendance.filter((row) => row._count._all > 0).map((row) => row.studentId));
  const chargesBy = new Map<string, typeof charges>();
  for (const charge of charges) {
    const list = chargesBy.get(charge.studentId) ?? [];
    list.push(charge);
    chargesBy.set(charge.studentId, list);
  }
  const paidBy = new Map<string, number>();
  for (const payment of payments) {
    paidBy.set(payment.studentId, (paidBy.get(payment.studentId) ?? 0) + (payment.amount || 0));
  }

  const candidates: Scanned[] = due.map(({ student, batch, timing }) => {
    const ledger = buildLedger(chargesBy.get(student.id) ?? [], paidBy.get(student.id) ?? 0);
    const next = nextLevelAfter(student.level);
    // What blocks a move: owed on a level the learner has ALREADY been in —
    // never the new level's own charge, never legacy arrears (chased, not walled).
    const ledgerOwed = ledger.lines
      .filter((line) => line.outstanding > 0 && !line.legacyArrears && line.level !== next)
      .reduce((sum, line) => sum + line.outstanding, 0);
    // PAID IN FULL is its own test. A learner with no charge row for the level they finished
    // used to read as owing nothing even when they had paid only a part — so the balance falls
    // back to the level's fee minus what they have paid whenever the ledger has no line for it.
    const paidSoFar = paidBy.get(student.id) ?? 0;
    const hasLevelLine = ledger.lines.some((line) => line.level === student.level);
    const fee = tuitionFeeFor({
      level: student.level,
      branch: student.branch?.name ?? null,
      classType: student.classType,
      pathway: student.pathway,
    });
    const priorLevelOwed = ledgerOwed + (hasLevelLine ? 0 : Math.max(0, fee - paidSoFar));
    // The same test the certificate and the portal paywall use: at least the deposit paid.
    const paidDeposit =
      (paidBy.get(student.id) ?? 0) >=
      requiredDepositFor({
        level: student.level,
        branch: student.branch?.name ?? null,
        classType: student.classType,
        pathway: student.pathway,
      });

    return {
      studentId: student.id,
      name: student.user?.name ?? "Unnamed",
      email: student.user?.email ?? "",
      branchId: student.branchId ?? null,
      branch: student.branch?.name ?? "Unassigned",
      tutorId: student.tutorId ?? null,
      offered: readJson(readJson(student.admission).nextLevel).manualOffer === true,
      paid: paidSoFar,
      balance: priorLevelOwed,
      level: student.level,
      batch,
      sessionSlot: student.sessionSlot,
      classType: student.classType ?? null,
      pathway: student.pathway ?? null,
      timing,
      landing: nextPlacement({
        batch,
        sessionSlot: student.sessionSlot,
        registeredAt: student.createdAt,
        now,
        startDayOverrides: options.startDayOverrides,
        level: nextLevelAfter(student.level),
      }),
      verdict: graduationVerdict({
        level: student.level,
        heldBackAt: student.heldBackAt,
        heldBackReason: student.heldBackReason,
        // Attendance registers were not kept for a long stretch and most learners only have a
        // batch month on file, so "has started" also counts a paid deposit — which is exactly
        // what the certificate asks for. A no-show who paid nothing is caught by `paidDeposit`.
        hasStarted: Boolean(
          (student.classesStartedAt && student.classesStartedAt.getTime() <= now.getTime()) ||
            attended.has(student.id) ||
            paidDeposit,
        ),
        paidDeposit,
        priorLevelOwed,
        formatMoney: naira,
      }),
    };
  });

  return { candidates, running, accounting };
}

/** The desk's own candidate list, for the sweep to compare against. */
export async function scanDeskCandidates(options: {
  where?: Record<string, unknown>;
  tenantId?: string | null;
  now?: Date;
}): Promise<Array<{ studentId: string }>> {
  const now = options.now ?? new Date();
  const startDayOverrides = await readIntakeStartDayOverrides(options.tenantId ?? null);
  const { candidates } = await scan({ where: options.where, now, startDayOverrides });
  return candidates.map((candidate) => ({ studentId: candidate.studentId }));
}

/* ------------------------------ auto setting ------------------------------ */

function parseAuto(value: unknown): GraduationAuto {
  const raw = readJson(value);
  return {
    enabled: raw.enabled === true,
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : null,
    lastRunSummary: typeof raw.lastRunSummary === "string" ? raw.lastRunSummary : null,
  };
}

export async function readGraduationAuto(tenantId: string | null | undefined): Promise<GraduationAuto> {
  if (!tenantId) return parseAuto(null);
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: GRADUATION_AUTO_KEY } },
    });
    return parseAuto(row?.value);
  } catch {
    return parseAuto(null);
  }
}

export async function writeGraduationAuto(
  tenantId: string,
  patch: Partial<GraduationAuto>,
): Promise<GraduationAuto> {
  const next = { ...(await readGraduationAuto(tenantId)), ...patch };
  await prisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: GRADUATION_AUTO_KEY } },
    update: { value: next },
    create: { tenantId, key: GRADUATION_AUTO_KEY, value: next },
  });
  return next;
}

/* --------------------------------- the desk -------------------------------- */

export async function loadGraduationDesk(options: {
  where?: Record<string, unknown>;
  tenantId?: string | null;
  now?: Date;
}): Promise<GraduationDesk> {
  const now = options.now ?? new Date();
  const startDayOverrides = await readIntakeStartDayOverrides(options.tenantId ?? null);
  const { candidates, running, accounting } = await scan({ where: options.where, now, startDayOverrides });

  const cohorts = new Map<string, DeskCohort>();
  for (const row of candidates) {
    const weekend = row.sessionSlot.toLowerCase() === "weekend";
    const key = `${row.branchId ?? "none"}|${row.level}|${row.batch}|${dayKey(row.timing.endsOn)}`;
    let cohort = cohorts.get(key);
    if (!cohort) {
      cohort = {
        key,
        branchId: row.branchId,
        branch: row.branch,
        level: row.level,
        nextLevel: nextLevelAfter(row.level),
        batch: row.batch,
        label: row.timing.label,
        weekend,
        endsOn: row.timing.endsOn.toISOString(),
        daysToEnd: row.timing.daysToEnd,
        ended: row.timing.ended,
        landing: row.landing
          ? { label: row.landing.label, startsOn: row.landing.startsOn.toISOString(), hasStarted: row.landing.hasStarted }
          : null,
        ready: 0,
        owes: 0,
        blocked: 0,
        students: [],
      };
      cohorts.set(key, cohort);
    }
    cohort.students.push({
      studentId: row.studentId,
      name: row.name,
      email: row.email,
      sitting: row.sessionSlot,
      verdict: row.verdict,
      offered: row.offered,
      paid: row.paid,
      balance: row.balance,
    });
    if (row.verdict.state === "ready") cohort.ready += 1;
    else if (row.verdict.reason === "fees") cohort.owes += 1;
    else cohort.blocked += 1;
  }

  const ordered = [...cohorts.values()]
    .map((cohort) => ({
      ...cohort,
      // Blocked names first inside a cohort — those are the ones needing a decision.
      students: cohort.students.sort(
        (a, b) => Number(a.verdict.state === "ready") - Number(b.verdict.state === "ready") || a.name.localeCompare(b.name),
      ),
    }))
    .sort((a, b) => a.daysToEnd - b.daysToEnd || a.branch.localeCompare(b.branch) || a.level.localeCompare(b.level));

  return {
    cohorts: ordered,
    running,
    accounting,
    wronglyMoved: await findWronglyMoved({ where: options.where, now }),
    auto: await readGraduationAuto(options.tenantId ?? null),
  };
}

/* ------------------------------- graduating ------------------------------- */

export type GraduationRun = {
  /** Signed off, certificate, moved up, and invited. */
  graduated: Array<{ studentId: string; name: string }>;
  /** Not moved (they owe on the level just finished) but invited — they can pay and move up themselves. */
  invited: Array<{ studentId: string; name: string; detail: string }>;
  skipped: Array<{ studentId: string; name: string; reason: string }>;
  certificatesIssued: number;
  /** Graduated but no certificate could be issued (reason per learner). */
  certificatesPending: Array<{ name: string; reason: string }>;
  /** Becca messages that went out (bell + push + email), moved and invited together. */
  notified: number;
  /** Tutors told how their class finished. */
  tutorsNotified: number;
};

export async function graduateStudents(
  studentIds: string[],
  options: {
    where?: Record<string, unknown>;
    tenantId?: string | null;
    now?: Date;
    /** Only learners whose batch has actually ended (the automatic run). */
    endedOnly?: boolean;
    /**
     * Which of the two explicit buttons this is. "move" touches only learners who paid in
     * full; "invite" touches only part-payers (it never moves anyone). Unset = both.
     */
    only?: "move" | "invite";
  } = {},
): Promise<GraduationRun> {
  const now = options.now ?? new Date();
  const run: GraduationRun = {
    graduated: [],
    invited: [],
    skipped: [],
    certificatesIssued: 0,
    certificatesPending: [],
    notified: 0,
    tutorsNotified: 0,
  };
  if (studentIds.length === 0) return run;

  const startDayOverrides = await readIntakeStartDayOverrides(options.tenantId ?? null);
  // Re-decided here, on the server, at the moment of the click.
  const { candidates } = await scan({ where: options.where, ids: studentIds, now, startDayOverrides });
  const byId = new Map(candidates.map((row) => [row.studentId, row]));

  const told: Array<{ row: Scanned; moved: boolean }> = [];

  for (const studentId of studentIds) {
    const row = byId.get(studentId);
    if (!row) {
      run.skipped.push({ studentId, name: studentId, reason: "Not due yet, or not found" });
      continue;
    }
    const owesOnly = row.verdict.state === "blocked" && row.verdict.reason === "fees";
    // The two buttons are separate on purpose: a press of one never does the other's job.
    if ((options.only === "move" && owesOnly) || (options.only === "invite" && row.verdict.state === "ready")) continue;
    if (row.verdict.state !== "ready" && !owesOnly) {
      run.skipped.push({ studentId, name: row.name, reason: row.verdict.detail });
      continue;
    }
    if (options.endedOnly && !row.timing.ended) {
      run.skipped.push({ studentId, name: row.name, reason: "Batch has not finished yet" });
      continue;
    }
    const next = nextLevelAfter(row.level);
    if (!next) continue;

    try {
      if (owesOnly) {
        // Invite, don't move: the money rule stands. They are marked offered so
        // the invitation reaches them even on a locked portal, and the checkout
        // takes it from there. An automatic run leaves anyone already invited alone.
        const { alreadyOffered } = await markOffered(studentId, next, now);
        if (options.endedOnly && alreadyOffered) {
          run.skipped.push({ studentId, name: row.name, reason: "Already invited" });
          continue;
        }
        run.invited.push({ studentId, name: row.name, detail: row.verdict.state === "blocked" ? row.verdict.detail : "" });
        told.push({ row, moved: false });
        continue;
      }

      // 1. Sign off. Quiet: Becca's message below replaces the generic one.
      await completeLevelForStudents([studentId], { now, announce: false });

      // 2. Certificate, while they are still on the level they finished. Dated
      // to the first moment the session counts as complete, so a batch
      // graduated a few days early still gets a valid one.
      const certificateNow = new Date(Math.max(now.getTime(), row.timing.endsOn.getTime() + 1));
      const certificate = await issueCertificateForStudent(studentId, { now: certificateNow }).catch(
        (error): { issued: false; reason: string } => ({
          issued: false,
          reason: error instanceof Error ? error.message : "Certificate could not be issued",
        }),
      );
      if (certificate.issued) run.certificatesIssued += certificate.created ? 1 : 0;
      else run.certificatesPending.push({ name: row.name, reason: certificate.reason });

      // 3. Move up — into the next intake, with the first-day date moved too.
      const promotion = await promoteStudents([studentId], { now, placement: "next-intake" });
      if (promotion.skipped.length > 0) {
        run.skipped.push({
          studentId,
          name: row.name,
          reason: `Signed off, but not moved up: ${promotion.skipped[0].reason}`,
        });
        continue;
      }
      // A moved-up learner is locked on the new level's deposit — the very person
      // the next-level message is for. Marking them offered is what lets it reach them.
      await markOffered(studentId, next, now);

      run.graduated.push({ studentId, name: row.name });
      told.push({ row, moved: true });
    } catch (error) {
      console.error("Graduation failed for a learner", { studentId, error });
      run.skipped.push({ studentId, name: row.name, reason: "Something went wrong — try this learner again" });
    }
  }

  // 4. Tell them — Becca's journey, personal to each learner, so one message
  // each (bell + push + email). A failure for one never stops the others.
  for (const { row } of told) {
    try {
      if (await sendBeccaInvite(row.studentId, now)) run.notified += 1;
    } catch (error) {
      console.error("Next-level invite failed after graduation", { studentId: row.studentId, error });
    }
  }

  // 5. Tell their tutors how the class finished — one note per tutor.
  run.tutorsNotified = await notifyTutors(told, now);

  return run;
}

/**
 * One short note per tutor: how many of their learners moved up and how many
 * were invited. Tutors never press a button for this; it just tells them why
 * their roster changed.
 */
async function notifyTutors(told: Array<{ row: Scanned; moved: boolean }>, now: Date): Promise<number> {
  const byTutor = new Map<string, { moved: number; invited: number; level: string; next: string; batch: string }>();
  for (const { row, moved } of told) {
    if (!row.tutorId) continue;
    const next = nextLevelAfter(row.level);
    if (!next) continue;
    const key = `${row.tutorId}|${row.level}|${row.batch}`;
    const entry = byTutor.get(key) ?? { moved: 0, invited: 0, level: row.level, next, batch: row.batch };
    if (moved) entry.moved += 1;
    else entry.invited += 1;
    byTutor.set(key, entry);
  }

  let sent = 0;
  for (const [key, entry] of byTutor) {
    const tutorId = key.split("|")[0];
    const parts = [
      entry.moved ? `${entry.moved} moved up to ${entry.next}` : "",
      entry.invited ? `${entry.invited} invited to ${entry.next} (they still owe on ${entry.level})` : "",
    ].filter(Boolean);
    try {
      const outcome = await notify({
        to: { lecturers: { lecturerIds: [tutorId] } },
        title: `Your ${entry.batch} ${entry.level} class has finished`,
        message: `${parts.join(" and ")}. Each of them has been sent their ${entry.next} plan and can confirm a seat from their portal.`,
        kind: "level-complete",
        severity: "info",
        link: "/lecturer/dashboard",
        dedupeKey: `graduation-tutor:${tutorId}:${entry.level}:${entry.batch}:${now.toISOString().slice(0, 10)}`,
        push: true,
        sms: false,
      });
      sent += outcome.created;
    } catch (error) {
      console.error("Tutor graduation note failed", error);
    }
  }
  return sent;
}

/**
 * Paying is signing off. A student whose batch has ended (or whom the office
 * invited) opens the next-level checkout, and the checkout calls this first, so
 * they never wait on a person to press "sign off" before they can pay. The same
 * gates the desk uses apply — held back or never started and it says no — and
 * the certificate is issued best-effort while they are still on the level they
 * finished. Anything owed on that level is NOT waived: the checkout bills it
 * together with the new deposit.
 */
export async function signOffForCheckout(studentId: string, now = new Date()): Promise<boolean> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      level: true,
      levelCompletedFor: true,
      levelCompletedAt: true,
      admission: true,
      classesStartedAt: true,
      createdAt: true,
      sessionSlot: true,
      tenantId: true,
      heldBackAt: true,
      heldBackReason: true,
      classType: true,
      pathway: true,
      branch: { select: { name: true } },
    },
  });
  if (!student) return false;
  if (student.levelCompletedFor === student.level && student.levelCompletedAt) return true;

  const overrides = await readIntakeStartDayOverrides(student.tenantId ?? null);
  const audience = resolveJourneyAudience({
    level: student.level,
    levelCompletedFor: student.levelCompletedFor,
    levelCompletedAt: student.levelCompletedAt,
    admission: student.admission,
    classesStartedAt: student.classesStartedAt,
    createdAt: student.createdAt,
    sessionSlot: student.sessionSlot,
    startDayOverrides: overrides,
    now,
  });
  if (!audience || (audience.state !== "ended" && audience.state !== "invited")) return false;

  const attendedCount =
    audience.state === "invited"
      ? 1
      : await prisma.attendance.count({
          where: { studentId, status: { in: ["present", "late"] } },
        });
  // Same test as the desk and the certificate: the deposit for the level they finished is in.
  const paid = await prisma.payment.aggregate({
    where: { studentId, deletedAt: null, ...receivedPaymentFilter() },
    _sum: { amount: true },
  });
  const paidDeposit =
    (paid._sum.amount ?? 0) >=
    requiredDepositFor({
      level: student.level,
      branch: student.branch?.name ?? null,
      classType: student.classType,
      pathway: student.pathway,
    });
  const verdict = graduationVerdict({
    level: student.level,
    heldBackAt: student.heldBackAt,
    heldBackReason: student.heldBackReason,
    hasStarted: Boolean(
      (student.classesStartedAt && student.classesStartedAt.getTime() <= now.getTime()) ||
        attendedCount > 0 ||
        paidDeposit,
    ),
    // A learner the office invited by hand is the office's decision; the deposit rule is for the automatic list.
    paidDeposit: audience.state === "invited" ? true : paidDeposit,
    // The checkout bills what is owed; it is not a reason to refuse the sign-off.
    priorLevelOwed: 0,
  });
  if (verdict.state !== "ready") return false;

  await completeLevelForStudents([studentId], { now, announce: false });
  await issueCertificateForStudent(studentId, { now }).catch(() => undefined);
  return true;
}

/* ------------------------------ morning summary ------------------------------ */

function tenantWhere(tenantId: string) {
  return { OR: [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }] };
}

/** Small stable hash, only used to tell "the same list as yesterday" from "a changed list". */
function signatureOf(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * One switch for the office: the MORNING SUMMARY. When it is on, the system checks
 * the finished batches every morning and TELLS the admins what it found; it never
 * moves, invites or messages a single learner by itself.
 *
 * It used to move people on its own. That was retired: automatic moves are only as
 * good as the data behind them, and where data is missing the system has to say
 * "a person should look", not guess. The hourly auto-send of Becca's message is
 * switched off with it, for the same reason. Reads back from this module's flag.
 */
export async function setBatchAutomatic(tenantId: string, enabled: boolean): Promise<GraduationAuto> {
  await writeNextLevelAuto(tenantId, { enabled: false });
  return writeGraduationAuto(tenantId, { enabled });
}

/**
 * The daily check (06:00 UTC). For every school that has the morning summary on,
 * counts per finished batch who is ready to move up, who owes (would be invited),
 * who needs a look and why, plus anyone wrongly moved up, then sends the admins ONE
 * bell + phone notification linking to the desk. The same list is never sent twice:
 * it is only sent again when the numbers change.
 */
export async function runAutoGraduation(
  options: { now?: Date; budgetMs?: number } = {},
): Promise<{ schools: number; suggested: number }> {
  const now = options.now ?? new Date();
  const started = Date.now();
  const budgetMs = options.budgetMs ?? 35_000;
  const total = { schools: 0, suggested: 0 };

  const rows = await prisma.schoolSetting.findMany({
    where: { key: GRADUATION_AUTO_KEY },
    select: { tenantId: true, value: true },
  });

  for (const row of rows) {
    if (!parseAuto(row.value).enabled) continue;
    total.schools += 1;
    if (Date.now() - started > budgetMs) break;

    await runWithTenant(row.tenantId, async () => {
      const where = tenantWhere(row.tenantId);
      const startDayOverrides = await readIntakeStartDayOverrides(row.tenantId);
      const { candidates } = await scan({ where, now, startDayOverrides });
      const wrong = await findWronglyMoved({ where, now });

      type Tally = { ready: number; owes: number; unpaid: number; held: number; other: number };
      const byBatch = new Map<string, Tally>();
      for (const candidate of candidates) {
        if (!candidate.timing.ended) continue;
        const name = `${candidate.batch} batch${candidate.sessionSlot.toLowerCase() === "weekend" ? " (weekend)" : ""}`;
        const tally = byBatch.get(name) ?? { ready: 0, owes: 0, unpaid: 0, held: 0, other: 0 };
        const verdict = candidate.verdict;
        if (verdict.state === "ready") tally.ready += 1;
        else if (verdict.reason === "fees") {
          if (!candidate.offered) tally.owes += 1;
        } else if (verdict.reason === "unpaid") tally.unpaid += 1;
        else if (verdict.reason === "held_back") tally.held += 1;
        else tally.other += 1;
        byBatch.set(name, tally);
      }

      let ready = 0;
      let owes = 0;
      const lines: string[] = [];
      for (const [name, t] of [...byBatch.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        ready += t.ready;
        owes += t.owes;
        const parts = [
          t.ready ? `${t.ready} paid in full, ready to move up` : "",
          t.owes ? `${t.owes} on part payment` : "",
          t.unpaid ? `${t.unpaid} have not paid the deposit` : "",
          t.held ? `${t.held} held back` : "",
          t.other ? `${t.other} need a look` : "",
        ].filter(Boolean);
        if (parts.length) lines.push(`${name}: ${parts.join(", ")}`);
      }
      if (wrong.length) lines.push(`${wrong.length} moved up without paying the deposit — use "Put back"`);

      // Only worth a ping when there is something to DO.
      if (ready + owes + wrong.length === 0) return;

      const outcome = await notify({
        to: { audience: "admin", capability: "students" },
        title: ready > 0 ? `${ready} learner${ready === 1 ? "" : "s"} can move up — your call` : "Finished batches need your attention",
        message: `${lines.join(". ")}. Open Finished batches to look and press the button. Nothing has been moved or sent.`,
        kind: "level-complete",
        severity: "info",
        link: "/admin/graduation",
        dedupeKey: `graduation-suggest:${row.tenantId}:${signatureOf(lines.join("|"))}`,
        push: true,
        email: false,
        sms: false,
      }).catch((error) => {
        console.error("Morning summary failed", error);
        return { created: 0 };
      });

      if (outcome.created > 0) total.suggested += 1;
      await writeGraduationAuto(row.tenantId, {
        lastRunAt: now.toISOString(),
        lastRunSummary: `${ready} ready, ${owes} to invite${wrong.length ? `, ${wrong.length} to put back` : ""}. ${outcome.created > 0 ? "Admins told." : "Same as last time, so no new message."}`,
      });
    });
  }

  return total;
}
