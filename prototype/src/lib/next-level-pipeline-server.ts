import { prisma } from "@/lib/prisma";
import { readIntakeStartDayOverrides } from "@/lib/intake-server";
import { KIND, notify } from "@/lib/notify";
import { runWithTenant } from "@/lib/tenant/context";
import {
  EXCLUSION_LABEL,
  INVITE_KEY_PREFIX,
  STAGE_LABEL,
  inviteKey,
  parseInviteKey,
  readIntent,
  resolveJourneyAudience,
  sendDecision,
  stageFor,
  whyExcluded,
  type ExclusionReason,
  type JourneyStage,
  type JourneyState,
  type SendDecision,
} from "@/lib/next-level-journey";
import { loadJourney, loadJourneyStudent, seatAndOwed } from "@/lib/next-level-journey-server";
import { buildInvite } from "@/lib/next-level-invite";
import {
  LOCKED_KEY_PREFIX,
  buildLockedNotice,
  lockedNoticeDue,
  lockedNoticeKey,
  parseLockedNoticeKey,
  type LockedFacts,
} from "@/lib/locked-notice";
import { getStudentAccess } from "@/lib/student-access";

/**
 * The office's view of the next-level journey: everyone who has just finished
 * (or been moved up), where each one stands, who has been messaged, and what
 * they told us — so the front desk calls the people who have gone quiet instead
 * of waiting to be asked about A2.
 */

export type PipelineRow = {
  studentId: string;
  name: string;
  email: string;
  studentCode: string | null;
  branch: string | null;
  state: JourneyState;
  finishedLevel: string;
  targetLevel: string;
  stage: JourneyStage;
  stageLabel: string;
  phone: string | null;
  parentPhone: string | null;
  requestedSlot: string | null;
  /** The intake month they chose for the next level, if they have. */
  requestedBatch: string | null;
  requestedMode: string | null;
  note: string | null;
  seenAt: string | null;
  heldAt: string | null;
  priorOwed: number;
  /** Their portal is open (paid at least the deposit, not locked). */
  portalOpen: boolean;
  /** The office chose them by hand — messaged even if their portal is locked. */
  manual: boolean;
  /** May receive the pop, the bell and the email — open portal and not yet held/paid. */
  eligible: boolean;
  /** When Becca's message last went to them (any route), or null if it never has. */
  messagedAt: string | null;
  /**
   * What a send would do for them: "send" (never messaged), "remind" (messaged
   * 3+ days ago and still hasn't opened it) or "already" (leave them be).
   * Only meaningful while `eligible`.
   */
  decision: SendDecision;
  /** Why not, in the office's words. */
  skipReason: string | null;
  /** The real figures behind a locked portal, for the status notice. Null when not locked. */
  lock: Omit<LockedFacts, "firstName" | "level"> | null;
  /** When the locked-portal status notice last went to them, or null. */
  noticedAt: string | null;
};

export type Pipeline = {
  rows: PipelineRow[];
  counts: Record<JourneyStage, number>;
  /** Why the rest of the school is not on this list — so "only 24 of 500" has an answer. */
  summary: {
    activeTotal: number;
    onList: number;
    portalLocked: number;
    /** Eligible and never messaged — what the Send button will reach. */
    toSend: number;
    /** Eligible, messaged 3+ days ago, still haven't opened it. */
    toRemind: number;
    /** Already messaged. */
    messaged: number;
    /** Locked portals that have never been sent the status notice. */
    lockedToNotify: number;
    /** Locked portals already sent it. */
    lockedNoticed: number;
    excluded: Array<{ reason: ExclusionReason; label: string; count: number }>;
  };
};

const STAGES = Object.keys(STAGE_LABEL) as JourneyStage[];

/** studentId -> the most recent time the locked-portal status notice went out. */
async function loadNoticedAt(): Promise<Map<string, string>> {
  const rows = await prisma.notification.findMany({
    where: { dedupeKey: { startsWith: LOCKED_KEY_PREFIX } },
    select: { dedupeKey: true, createdAt: true },
  });
  const latest = new Map<string, string>();
  for (const row of rows) {
    const parsed = parseLockedNoticeKey(row.dedupeKey);
    if (!parsed) continue;
    const at = row.createdAt.toISOString();
    const prev = latest.get(parsed.studentId);
    if (!prev || at > prev) latest.set(parsed.studentId, at);
  }
  return latest;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** studentId:targetLevel -> the most recent time a message went out. */
async function loadMessagedAt(): Promise<Map<string, string>> {
  const rows = await prisma.notification.findMany({
    where: { dedupeKey: { startsWith: INVITE_KEY_PREFIX } },
    select: { dedupeKey: true, createdAt: true },
  });
  const latest = new Map<string, string>();
  for (const row of rows) {
    const parsed = parseInviteKey(row.dedupeKey);
    if (!parsed) continue;
    const key = `${parsed.studentId}:${parsed.targetLevel}`;
    const at = row.createdAt.toISOString();
    const prev = latest.get(key);
    if (!prev || at > prev) latest.set(key, at);
  }
  return latest;
}

export async function loadPipeline(opts: { where: Record<string, unknown>; tenantId: string | null }): Promise<Pipeline> {
  const now = new Date();
  const overrides = await readIntakeStartDayOverrides(opts.tenantId);

  const students = await prisma.student.findMany({
    where: { ...opts.where, status: "active" } as never,
    select: {
      id: true,
      level: true,
      levelCompletedFor: true,
      levelCompletedAt: true,
      admission: true,
      classesStartedAt: true,
      createdAt: true,
      sessionSlot: true,
      studentCode: true,
      branch: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });

  const messagedAt = await loadMessagedAt();
  const noticedAt = await loadNoticedAt();

  const inAudience = students
    .map((s) => ({
      s,
      audience: resolveJourneyAudience({
        level: s.level,
        levelCompletedFor: s.levelCompletedFor,
        levelCompletedAt: s.levelCompletedAt,
        admission: s.admission,
        classesStartedAt: s.classesStartedAt,
        createdAt: s.createdAt,
        sessionSlot: s.sessionSlot,
        startDayOverrides: overrides,
        now,
      }),
    }))
    .filter((x): x is typeof x & { audience: NonNullable<typeof x.audience> } => x.audience !== null);

  const rows: PipelineRow[] = [];
  // Ledger reads are a handful of queries each — keep them to small parallel
  // batches rather than hundreds at once.
  for (let i = 0; i < inAudience.length; i += 8) {
    const slice = inAudience.slice(i, i + 8);
    const money = await Promise.all(slice.map((x) => seatAndOwed(x.s.id, x.audience.targetLevel)));
    const access = await Promise.all(slice.map((x) => getStudentAccess(x.s.id)));
    slice.forEach((x, idx) => {
      const admission = asRecord(x.s.admission);
      const intent = readIntent(admission, x.audience.targetLevel);
      const stage = stageFor(intent, money[idx].seat);
      const portalOpen = access[idx]?.hasAccess === true;
      const manual = intent?.manualOffer === true;
      const reachable = portalOpen || manual;
      const answered = stage === "held" || stage === "deposit_paid" || stage === "paid_in_full";
      const sentAt = messagedAt.get(`${x.s.id}:${x.audience.targetLevel}`) ?? null;
      const acc = access[idx];
      rows.push({
        studentId: x.s.id,
        name: x.s.user.name || x.s.user.email,
        email: x.s.user.email,
        studentCode: x.s.studentCode,
        branch: x.s.branch?.name ?? null,
        state: x.audience.state,
        finishedLevel: x.audience.finishedLevel,
        targetLevel: x.audience.targetLevel,
        stage,
        stageLabel: STAGE_LABEL[stage],
        phone: intent?.details?.phone ?? (typeof admission.phone === "string" ? admission.phone : null),
        parentPhone:
          intent?.details?.parentPhone ?? (typeof admission.parentPhone === "string" ? admission.parentPhone : null),
        requestedSlot: intent?.details?.sessionSlot ?? null,
        requestedBatch: intent?.details?.batch ?? null,
        requestedMode: intent?.details?.deliveryMode ?? null,
        note: intent?.details?.note ?? null,
        seenAt: intent?.seenAt ?? null,
        heldAt: intent?.heldAt ?? null,
        priorOwed: money[idx].priorOwed,
        portalOpen,
        manual,
        eligible: reachable && !answered,
        messagedAt: sentAt,
        decision: sendDecision({ messagedAt: sentAt, seenAt: intent?.seenAt ?? null, heldAt: intent?.heldAt ?? null }, now),
        skipReason: !reachable
          ? "Portal is locked — not messaged until they have paid at least the deposit"
          : answered
            ? "Already answered"
            : null,
        lock:
          !portalOpen && !manual && acc
            ? {
                reason: acc.lockReason,
                depositOutstanding: acc.outstanding,
                requiredDeposit: acc.requiredDeposit,
                balanceOutstanding: acc.outstandingBalance,
                tuitionFee: acc.tuitionFee,
                totalPaid: acc.totalPaid,
                lockAt: acc.lockAt,
              }
            : null,
        noticedAt: noticedAt.get(x.s.id) ?? null,
      });
    });
  }

  // Least engaged first: those are the people worth a phone call today.
  const order: Record<JourneyStage, number> = { not_opened: 0, opened: 1, held: 2, deposit_paid: 3, paid_in_full: 4 };
  rows.sort((a, b) => order[a.stage] - order[b.stage] || a.name.localeCompare(b.name));

  const counts = Object.fromEntries(STAGES.map((st) => [st, rows.filter((r) => r.stage === st).length])) as Record<
    JourneyStage,
    number
  >;
  const reasons = new Map<ExclusionReason, number>();
  for (const s of students) {
    const reason = whyExcluded({
      level: s.level,
      levelCompletedFor: s.levelCompletedFor,
      levelCompletedAt: s.levelCompletedAt,
      admission: s.admission,
      classesStartedAt: s.classesStartedAt,
      createdAt: s.createdAt,
      sessionSlot: s.sessionSlot,
      startDayOverrides: overrides,
      now,
    });
    if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const summary: Pipeline["summary"] = {
    activeTotal: students.length,
    onList: rows.length,
    portalLocked: rows.filter((r) => !r.portalOpen && !r.manual).length,
    toSend: rows.filter((r) => r.eligible && r.decision === "send").length,
    toRemind: rows.filter((r) => r.eligible && r.decision === "remind").length,
    messaged: rows.filter((r) => r.messagedAt).length,
    lockedToNotify: rows.filter((r) => r.lock && lockedNoticeDue(r.noticedAt, now) === "send").length,
    lockedNoticed: rows.filter((r) => r.lock && r.noticedAt).length,
    excluded: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, label: EXCLUSION_LABEL[reason], count }))
      .sort((a, b) => b.count - a.count),
  };
  return { rows, counts, summary };
}

/**
 * The one message, to everyone it should reach, all three ways at once: the
 * bell + push, and a designed email with each student's own numbers in it. The
 * Becca pop on their dashboard is driven by the same eligibility, so a student
 * sees all of it at the same moment.
 *
 * Whatever ids the browser names, a student is only sent to when they are
 * `eligible` AND the decision allows it: never-messaged students always; a
 * reminder only when `includeReminders` is set and they still haven't opened it
 * 3+ days on. Anyone messaged recently is left alone, so pressing Send twice —
 * or the automatic run firing every hour — can never double-message anyone.
 */
export async function sendInvites(
  rows: PipelineRow[],
  studentIds: string[],
  opts: { includeReminders?: boolean; now?: Date } = {},
): Promise<{ sent: number; alreadyMessaged: number; skippedLocked: number; skipped: number }> {
  const wanted = new Set(studentIds);
  const now = opts.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  let sent = 0;
  let alreadyMessaged = 0;
  let skipped = 0;
  let skippedLocked = 0;

  for (const row of rows) {
    if (!wanted.has(row.studentId)) continue;
    if (!row.portalOpen && !row.manual) {
      skippedLocked += 1;
      continue;
    }
    if (!row.eligible) {
      skipped += 1;
      continue;
    }
    if (row.decision === "already" || (row.decision === "remind" && !opts.includeReminders)) {
      alreadyMessaged += 1;
      continue;
    }
    try {
      const student = await loadJourneyStudent({ id: row.studentId });
      const journey = student ? await loadJourney(student) : null;
      if (!student || !journey || !journey.reachable) {
        skipped += 1;
        continue;
      }
      const invite = buildInvite(journey, student.user.name);
      const result = await notify({
        to: { studentIds: [row.studentId] },
        kind: KIND.levelAdvance,
        severity: "info",
        title: invite.title,
        message: invite.message,
        emailBody: invite.emailBody,
        emailHtmlFor: () => invite.html,
        link: "/next-level",
        dedupeKey: inviteKey(row.studentId, row.targetLevel, day),
      });
      // `created` is zero when the same message already went out today, so a
      // double-click is reported honestly instead of as a second send.
      if (result.created > 0) sent += 1;
      else alreadyMessaged += 1;
    } catch (error) {
      skipped += 1;
      console.error("next-level invite failed", { studentId: row.studentId, error });
    }
  }
  return { sent, alreadyMessaged, skippedLocked, skipped };
}

/** What a student would get, for the office to look at before pressing send. */
export async function previewInvite(studentId: string) {
  const student = await loadJourneyStudent({ id: studentId });
  const journey = student ? await loadJourney(student) : null;
  if (!student || !journey) return null;
  return { name: student.user.name || student.user.email, ...buildInvite(journey, student.user.name) };
}

/* -------------------------------------------------------------------------- */
/* Locked portals: the status notice                                           */
/* -------------------------------------------------------------------------- */

function factsFor(row: PipelineRow): LockedFacts | null {
  if (!row.lock) return null;
  return { ...row.lock, firstName: row.name.split(/\s+/)[0] || "", level: row.finishedLevel };
}

/**
 * The separate message for students the next-level message skips: where they
 * stand, in their own figures, and what opens their portal. Bell + email, never
 * SMS (a text per student costs money, and tuition reminders text by default).
 *
 * Only rows that really are locked are sent to, whatever ids the browser names;
 * anyone noticed in the last week is left alone, so a second press does nothing.
 */
export async function sendLockedNotices(
  rows: PipelineRow[],
  studentIds: string[],
  opts: { includeAgain?: boolean; now?: Date } = {},
): Promise<{ sent: number; alreadyNoticed: number; notLocked: number; failed: number }> {
  const wanted = new Set(studentIds);
  const now = opts.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  let sent = 0;
  let alreadyNoticed = 0;
  let notLocked = 0;
  let failed = 0;

  for (const row of rows) {
    if (!wanted.has(row.studentId)) continue;
    const facts = factsFor(row);
    if (!facts) {
      notLocked += 1;
      continue;
    }
    const due = lockedNoticeDue(row.noticedAt, now);
    if (due === "already" || (due === "again" && !opts.includeAgain)) {
      alreadyNoticed += 1;
      continue;
    }
    try {
      const notice = buildLockedNotice(facts);
      const result = await notify({
        to: { studentIds: [row.studentId] },
        kind: KIND.tuitionReminder,
        severity: "info",
        title: notice.title,
        message: notice.message,
        emailBody: notice.emailBody,
        emailHtmlFor: () => notice.html,
        link: "/payments",
        sms: false,
        dedupeKey: lockedNoticeKey(row.studentId, day),
      });
      if (result.created > 0) sent += 1;
      else alreadyNoticed += 1;
    } catch (error) {
      failed += 1;
      console.error("locked notice failed", { studentId: row.studentId, error });
    }
  }
  return { sent, alreadyNoticed, notLocked, failed };
}

/** What a locked student would get, to read before pressing send. */
export function previewLockedNotice(rows: PipelineRow[], studentId?: string | null) {
  const row = (studentId ? rows.find((r) => r.studentId === studentId && r.lock) : null) ?? rows.find((r) => r.lock);
  const facts = row ? factsFor(row) : null;
  return row && facts ? { name: row.name, ...buildLockedNotice(facts) } : null;
}

/* -------------------------------------------------------------------------- */
/* Automatic mode                                                              */
/* -------------------------------------------------------------------------- */

export const NEXT_LEVEL_AUTO_KEY = "next-level.auto";

export type NextLevelAuto = {
  enabled: boolean;
  lastRunAt: string | null;
  lastRunSummary: string | null;
};

function parseAuto(value: unknown): NextLevelAuto {
  const raw = asRecord(value);
  return {
    enabled: raw.enabled === true,
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : null,
    lastRunSummary: typeof raw.lastRunSummary === "string" ? raw.lastRunSummary : null,
  };
}

export async function readNextLevelAuto(tenantId: string | null | undefined): Promise<NextLevelAuto> {
  if (!tenantId) return parseAuto(null);
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: NEXT_LEVEL_AUTO_KEY } },
    });
    return parseAuto(row?.value);
  } catch {
    return parseAuto(null);
  }
}

export async function writeNextLevelAuto(tenantId: string, patch: Partial<NextLevelAuto>): Promise<NextLevelAuto> {
  const next = { ...(await readNextLevelAuto(tenantId)), ...patch };
  await prisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: NEXT_LEVEL_AUTO_KEY } },
    update: { value: next },
    create: { tenantId, key: NEXT_LEVEL_AUTO_KEY, value: next },
  });
  return next;
}

/**
 * The hands-off mode. For every school that has switched it on, anyone who has
 * become eligible and has NEVER been messaged gets Becca's message — bell, push
 * and email — without anyone pressing anything. Reminders stay a button: an
 * automatic nudge to someone who already ignored one is how a school gets
 * filtered into the spam folder.
 *
 * Safe to run as often as the scheduler likes: it only ever reaches people with
 * decision "send", and the send itself is de-duplicated.
 */
export async function runAutoNextLevel(
  options: { now?: Date; cap?: number; budgetMs?: number } = {},
): Promise<{ schools: number; sent: number; skipped: number }> {
  const now = options.now ?? new Date();
  const cap = options.cap ?? 120;
  const started = Date.now();
  const budgetMs = options.budgetMs ?? 40_000;
  const total = { schools: 0, sent: 0, skipped: 0 };

  const settings = await prisma.schoolSetting.findMany({
    where: { key: NEXT_LEVEL_AUTO_KEY },
    select: { tenantId: true, value: true },
  });

  for (const setting of settings) {
    if (!parseAuto(setting.value).enabled) continue;
    total.schools += 1;
    if (Date.now() - started > budgetMs) break;

    await runWithTenant(setting.tenantId, async () => {
      const tenantId = setting.tenantId;
      const pipeline = await loadPipeline({
        where: { OR: [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }] },
        tenantId,
      });
      const ids = pipeline.rows
        .filter((row) => row.eligible && row.decision === "send")
        .map((row) => row.studentId)
        .slice(0, cap);
      if (ids.length === 0) return;

      const result = await sendInvites(pipeline.rows, ids, { now });
      total.sent += result.sent;
      total.skipped += result.skipped + result.alreadyMessaged + result.skippedLocked;
      if (result.sent > 0) {
        await writeNextLevelAuto(tenantId, {
          lastRunAt: now.toISOString(),
          lastRunSummary: `Messaged ${result.sent} new student${result.sent === 1 ? "" : "s"} automatically.`,
        });
      }
    });
  }
  return total;
}
