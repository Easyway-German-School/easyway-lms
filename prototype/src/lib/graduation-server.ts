import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant/context";
import { notify } from "@/lib/notify";
import { batchFromAdmission } from "@/lib/batch";
import { buildLedger } from "@/lib/finance/ledger";
import { naira } from "@/lib/finance/receivables";
import { receivedPaymentFilter, requiredDepositFor } from "@/lib/payment";
import { nextLevelAfter } from "@/lib/levels";
import { completeLevelForStudents } from "@/lib/germany-journey-server";
import { issueCertificateForStudent } from "@/lib/certificates";
import { promoteStudents } from "@/lib/promotion";
import { readIntakeStartDayOverrides } from "@/lib/intake-server";
import type { IntakeStartDayOverrides } from "@/lib/intake";
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
 *   4. tell them                 — one message: finished, results and
 *                                  certificate are ready, here is what the next
 *                                  class costs to confirm
 *
 * Only learners the desk calls "ready" are ever touched, by hand or by the
 * automatic run. The verdict is recomputed on the server at click time — the
 * browser's list is never trusted.
 */

export const GRADUATION_AUTO_KEY = "graduation.auto";

export type DeskStudent = {
  studentId: string;
  name: string;
  email: string;
  sitting: string;
  verdict: GraduationVerdict;
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
  auto: GraduationAuto;
};

type Scanned = {
  studentId: string;
  name: string;
  email: string;
  branchId: string | null;
  branch: string;
  level: string;
  batch: string;
  sessionSlot: string;
  classType: string | null;
  pathway: string | null;
  timing: CohortTiming;
  landing: NextPlacement | null;
  verdict: GraduationVerdict;
};

type Scan = { candidates: Scanned[]; running: RunningBatch[] };

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
      branch: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });

  const due: Array<{ student: (typeof students)[number]; batch: string; timing: CohortTiming }> = [];
  const runningMap = new Map<string, RunningBatch>();

  for (const student of students) {
    if (!nextLevelAfter(student.level)) continue;
    const batch = batchFromAdmission(student.admission);
    if (!batch) continue;
    const timing = cohortTiming({
      batch,
      sessionSlot: student.sessionSlot,
      registeredAt: student.createdAt,
      now,
    });
    if (!timing) continue;

    if (timing.graduatable) {
      due.push({ student, batch, timing });
    } else if (timing.startsOn.getTime() <= now.getTime()) {
      // Mid-course. Listed so the office can see what is coming, never actionable.
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
    }
  }

  const running = [...runningMap.values()].sort((a, b) => a.daysToEnd - b.daysToEnd);
  if (due.length === 0) return { candidates: [], running };

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
    const priorLevelOwed = ledger.lines
      .filter((line) => line.outstanding > 0 && !line.legacyArrears && line.level !== next)
      .reduce((sum, line) => sum + line.outstanding, 0);

    return {
      studentId: student.id,
      name: student.user?.name ?? "Unnamed",
      email: student.user?.email ?? "",
      branchId: student.branchId ?? null,
      branch: student.branch?.name ?? "Unassigned",
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
        hasStarted: Boolean(
          (student.classesStartedAt && student.classesStartedAt.getTime() <= now.getTime()) ||
            attended.has(student.id),
        ),
        priorLevelOwed,
        formatMoney: naira,
      }),
    };
  });

  return { candidates, running };
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
  const { candidates, running } = await scan({ where: options.where, now, startDayOverrides });

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
    });
    if (row.verdict.state === "ready") cohort.ready += 1;
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

  return { cohorts: ordered, running, auto: await readGraduationAuto(options.tenantId ?? null) };
}

/* ------------------------------- graduating ------------------------------- */

export type GraduationRun = {
  graduated: Array<{ studentId: string; name: string }>;
  skipped: Array<{ studentId: string; name: string; reason: string }>;
  certificatesIssued: number;
  /** Graduated but no certificate could be issued (reason per learner). */
  certificatesPending: Array<{ name: string; reason: string }>;
  notified: number;
};

export async function graduateStudents(
  studentIds: string[],
  options: {
    where?: Record<string, unknown>;
    tenantId?: string | null;
    now?: Date;
    /** Only learners whose batch has actually ended (the automatic run). */
    endedOnly?: boolean;
  } = {},
): Promise<GraduationRun> {
  const now = options.now ?? new Date();
  const run: GraduationRun = {
    graduated: [],
    skipped: [],
    certificatesIssued: 0,
    certificatesPending: [],
    notified: 0,
  };
  if (studentIds.length === 0) return run;

  const startDayOverrides = await readIntakeStartDayOverrides(options.tenantId ?? null);
  // Re-decided here, on the server, at the moment of the click.
  const { candidates } = await scan({ where: options.where, ids: studentIds, now, startDayOverrides });
  const byId = new Map(candidates.map((row) => [row.studentId, row]));

  type Told = { row: Scanned; certificate: boolean };
  const told: Told[] = [];

  for (const studentId of studentIds) {
    const row = byId.get(studentId);
    if (!row) {
      run.skipped.push({ studentId, name: studentId, reason: "Not due yet, or not found" });
      continue;
    }
    if (row.verdict.state !== "ready") {
      run.skipped.push({ studentId, name: row.name, reason: row.verdict.detail });
      continue;
    }
    if (options.endedOnly && !row.timing.ended) {
      run.skipped.push({ studentId, name: row.name, reason: "Batch has not finished yet" });
      continue;
    }

    try {
      // 1. Sign off. Quiet: the message below replaces the generic one.
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

      run.graduated.push({ studentId, name: row.name });
      told.push({ row, certificate: certificate.issued });
    } catch (error) {
      console.error("Graduation failed for a learner", { studentId, error });
      run.skipped.push({ studentId, name: row.name, reason: "Something went wrong — try this learner again" });
    }
  }

  // 4. Tell them. Learners in the same position get identical words, so a
  // whole batch is a handful of notify() calls, not one per person.
  const groups = new Map<string, { title: string; message: string; emailBody: string; studentIds: string[]; dedupeKey: string }>();
  for (const { row, certificate } of told) {
    const next = nextLevelAfter(row.level);
    if (!next) continue;
    const deposit = requiredDepositFor({
      level: next,
      branch: row.branch === "Unassigned" ? null : row.branch,
      classType: row.classType,
      pathway: row.pathway,
    });
    const place = row.landing;
    const opens = place
      ? place.startsOn.toLocaleDateString("en-NG", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "Africa/Lagos",
        })
      : null;
    const results = certificate
      ? "Your results and your certificate are ready in your portal."
      : "Your results are ready in your portal.";
    const nextStep =
      place && !place.hasStarted
        ? `Your ${next} class opens ${opens}. Confirm your seat by paying the ${naira(deposit)} deposit from your Payments page.`
        : `Your ${next} class is under way. Pay the ${naira(deposit)} deposit from your Payments page to open your classroom.`;

    const title = `You have finished ${row.level} — well done!`;
    const message = `Becca here — congratulations on finishing ${row.level}! ${results} ${nextStep}`;
    const key = `${title}\u0000${message}`;
    const group =
      groups.get(key) ??
      {
        title,
        message,
        emailBody: `${message}\n\nYour ${next} classroom opens as soon as your deposit is in. Your results and certificate stay open to you whatever happens next.`,
        studentIds: [],
        dedupeKey: `graduation:${row.level}:${row.batch}:${place?.label ?? "now"}`,
      };
    group.studentIds.push(row.studentId);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    try {
      const outcome = await notify({
        to: { studentIds: group.studentIds },
        title: group.title,
        message: group.message,
        emailBody: group.emailBody,
        kind: "level-complete",
        severity: "success",
        link: "/certificates",
        dedupeKey: group.dedupeKey,
        push: true,
        email: true,
        sms: false,
      });
      run.notified += outcome.created;
    } catch (error) {
      console.error("Graduation announcement failed", error);
    }
  }

  return run;
}

/* ------------------------------ automatic run ------------------------------ */

function tenantWhere(tenantId: string) {
  return { OR: [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }] };
}

/**
 * The daily automatic run. For every school that has switched it on, moves on
 * every learner the desk calls ready whose batch has actually FINISHED (the
 * manual button may go a fortnight early; the automatic one never does).
 * Capped per run so the cron job's time budget holds — the remainder is picked
 * up the next day, and the desk shows anything left.
 */
export async function runAutoGraduation(
  options: { now?: Date; cap?: number; budgetMs?: number } = {},
): Promise<{ schools: number; graduated: number; skipped: number }> {
  const now = options.now ?? new Date();
  const cap = options.cap ?? 60;
  const started = Date.now();
  const budgetMs = options.budgetMs ?? 35_000;
  const total = { schools: 0, graduated: 0, skipped: 0 };

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
      const ids = candidates
        .filter((candidate) => candidate.verdict.state === "ready" && candidate.timing.ended)
        .map((candidate) => candidate.studentId)
        .slice(0, cap);

      let graduated = 0;
      let skipped = 0;
      // Small slices, so a slow run stops between them instead of mid-learner.
      for (let i = 0; i < ids.length; i += 10) {
        if (Date.now() - started > budgetMs) break;
        const result = await graduateStudents(ids.slice(i, i + 10), {
          where,
          tenantId: row.tenantId,
          now,
          endedOnly: true,
        });
        graduated += result.graduated.length;
        skipped += result.skipped.length;
      }

      total.graduated += graduated;
      total.skipped += skipped;
      if (graduated > 0 || skipped > 0) {
        await writeGraduationAuto(row.tenantId, {
          lastRunAt: now.toISOString(),
          lastRunSummary: `Moved up ${graduated} learner${graduated === 1 ? "" : "s"}${skipped ? `, ${skipped} left for the office` : ""}.`,
        });
      }
    });
  }

  return total;
}
