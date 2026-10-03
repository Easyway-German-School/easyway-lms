import { prisma } from "@/lib/prisma";
import { readIntakeStartDayOverrides } from "@/lib/intake-server";
import { KIND, notify } from "@/lib/notify";
import {
  STAGE_LABEL,
  readIntent,
  EXCLUSION_LABEL,
  resolveJourneyAudience,
  stageFor,
  whyExcluded,
  type ExclusionReason,
  type JourneyStage,
  type JourneyState,
} from "@/lib/next-level-journey";
import { loadJourney, loadJourneyStudent, seatAndOwed } from "@/lib/next-level-journey-server";
import { buildInvite } from "@/lib/next-level-invite";
import { getStudentAccess } from "@/lib/student-access";

/**
 * The office's view of the next-level journey: everyone who has just finished
 * (or been moved up), where each one stands, and what they told us — so the
 * front desk calls the people who have gone quiet instead of waiting to be
 * asked about A2.
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
  requestedMode: string | null;
  note: string | null;
  seenAt: string | null;
  heldAt: string | null;
  priorOwed: number;
  /** Their portal is open (paid at least the deposit, not locked). */
  portalOpen: boolean;
  /** The office chose them by hand — messaged even if their portal is locked. */
  manual: boolean;
  /** Will receive the pop, the bell and the email — open portal and not yet held/paid. */
  eligible: boolean;
  /** Why not, in the office's words. */
  skipReason: string | null;
};

export type Pipeline = {
  rows: PipelineRow[];
  counts: Record<JourneyStage, number>;
  /** Why the rest of the school is not on this list — so "only 24 of 500" has an answer. */
  summary: {
    activeTotal: number;
    onList: number;
    portalLocked: number;
    excluded: Array<{ reason: ExclusionReason; label: string; count: number }>;
  };
};

const STAGES = Object.keys(STAGE_LABEL) as JourneyStage[];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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
        requestedMode: intent?.details?.deliveryMode ?? null,
        note: intent?.details?.note ?? null,
        seenAt: intent?.seenAt ?? null,
        heldAt: intent?.heldAt ?? null,
        priorOwed: money[idx].priorOwed,
        portalOpen,
        manual,
        eligible: reachable && !answered,
        skipReason: !reachable
          ? "Portal is locked — not messaged until they have paid at least the deposit"
          : answered
            ? "Already answered"
            : null,
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
    portalLocked: rows.filter((r) => !r.portalOpen).length,
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
 * Only rows that are `eligible` (portal open, not yet answered) are sent to,
 * whatever ids the browser names. One per student per day (the dedupeKey).
 */
export async function sendInvites(
  rows: PipelineRow[],
  studentIds: string[],
): Promise<{ sent: number; skipped: number; skippedLocked: number }> {
  const wanted = new Set(studentIds);
  const day = new Date().toISOString().slice(0, 10);
  let sent = 0;
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
    try {
      const student = await loadJourneyStudent({ id: row.studentId });
      const journey = student ? await loadJourney(student) : null;
      if (!student || !journey || !journey.reachable) {
        skipped += 1;
        continue;
      }
      const invite = buildInvite(journey, student.user.name);
      await notify({
        to: { studentIds: [row.studentId] },
        kind: KIND.levelAdvance,
        severity: "info",
        title: invite.title,
        message: invite.message,
        emailBody: invite.emailBody,
        emailHtmlFor: () => invite.html,
        link: "/next-level",
        dedupeKey: `next-level-invite:${row.studentId}:${row.targetLevel}:${day}`,
      });
      sent += 1;
    } catch (error) {
      skipped += 1;
      console.error("next-level invite failed", { studentId: row.studentId, error });
    }
  }
  return { sent, skipped, skippedLocked };
}

/** What a student would get, for the office to look at before pressing send. */
export async function previewInvite(studentId: string) {
  const student = await loadJourneyStudent({ id: studentId });
  const journey = student ? await loadJourney(student) : null;
  if (!student || !journey) return null;
  return { name: student.user.name || student.user.email, ...buildInvite(journey, student.user.name) };
}
