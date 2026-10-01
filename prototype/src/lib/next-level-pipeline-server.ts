import { prisma } from "@/lib/prisma";
import { readIntakeStartDayOverrides } from "@/lib/intake-server";
import { KIND, notify } from "@/lib/notify";
import {
  STAGE_LABEL,
  readIntent,
  resolveJourneyAudience,
  stageFor,
  type JourneyStage,
  type JourneyState,
} from "@/lib/next-level-journey";
import { seatAndOwed } from "@/lib/next-level-journey-server";

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
};

export type Pipeline = {
  rows: PipelineRow[];
  counts: Record<JourneyStage, number>;
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

  const attended = await prisma.attendance.groupBy({
    by: ["studentId"],
    where: { studentId: { in: students.map((s) => s.id) }, present: true },
  });
  const attendedIds = new Set(attended.map((a) => a.studentId));

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
        hasAttended: attendedIds.has(s.id),
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
    slice.forEach((x, idx) => {
      const admission = asRecord(x.s.admission);
      const intent = readIntent(admission, x.audience.targetLevel);
      const stage = stageFor(intent, money[idx].seat);
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
  return { rows, counts };
}

/**
 * A personal reminder from Becca to students who have not kept a seat yet. One
 * per student per day (the dedupeKey), and never to anyone who has already
 * held, or paid.
 */
export async function nudgeStudents(
  rows: PipelineRow[],
  studentIds: string[],
): Promise<{ sent: number; skipped: number }> {
  const wanted = new Set(studentIds);
  const day = new Date().toISOString().slice(0, 10);
  let sent = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!wanted.has(row.studentId)) continue;
    if (row.stage === "held" || row.stage === "deposit_paid" || row.stage === "paid_in_full") {
      skipped += 1;
      continue;
    }
    const first = row.name.split(/\s+/)[0] || "there";
    await notify({
      to: { studentIds: [row.studentId] },
      kind: KIND.levelAdvance,
      severity: "info",
      title: `${first}, your ${row.targetLevel} seat is waiting`,
      message: `You finished ${row.finishedLevel}. I put together what you achieved and a ${row.targetLevel} plan built around how you learn — it takes two minutes, and you can keep your seat from there.`,
      link: "/next-level",
      dedupeKey: `next-level-nudge:${row.studentId}:${row.targetLevel}:${day}`,
    }).catch((error) => console.error("next-level nudge failed", { studentId: row.studentId, error }));
    sent += 1;
  }
  return { sent, skipped };
}
