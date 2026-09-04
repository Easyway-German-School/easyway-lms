import { prisma } from "@/lib/prisma";
import { notify, KIND } from "@/lib/notify";
import { computeStudentFinance, type FinanceStudentInput } from "@/lib/finance/receivables";
import { RECEIVED_PAYMENT_STATUSES } from "@/lib/payment";

/**
 * CHURN RISK — a different question from the dashboard's existing "at risk".
 *
 * `/api/admin/overview`'s `actionQueue.atRisk` means one specific thing: behind
 * on tuition. A fully-paid student who has not opened the app in three weeks is
 * invisible to it. This module answers the other question — is this student
 * drifting away — and is deliberately named and labelled "churn risk" /
 * "Going quiet" everywhere it surfaces, so the two never get confused on the
 * dashboard or in code.
 *
 * Mirrors the shape of lib/finance/receivables.ts on purpose: a pure
 * `compute*` function, a presets map in the same shape as `FOCUS_PRESETS`, and
 * a lookup function — the same pattern, not a new one.
 *
 * Computed on read every time, like receivables.ts does for finance. No score
 * is persisted, so this needs no schema migration.
 */

export const CHURN_MIN_DAYS_ENROLLED = 14;

export type ChurnRiskLevel = "low" | "medium" | "high" | "critical";

export type ChurnRiskInput = {
  id: string;
  createdAt: Date;
  notStartedCount: number;
  /** Attendance rows from roughly the last 30–35 days. */
  recentAttendance: Array<{ present: boolean; status: string | null }>;
  lastVideoActivityAt: Date | null;
  lastJourneyEventAt: Date | null;
  /** Reused from receivables.ts rather than recomputed. */
  behindOnTuition: boolean;
};

export type ChurnRisk = {
  score: number;
  level: ChurnRiskLevel;
  reasons: string[];
};

function levelFor(score: number): ChurnRiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function computeChurnRisk(input: ChurnRiskInput, now: Date = new Date()): ChurnRisk {
  const daysEnrolled = Math.max(0, Math.floor((now.getTime() - input.createdAt.getTime()) / (24 * 60 * 60 * 1000)));
  const hasHistory = daysEnrolled >= CHURN_MIN_DAYS_ENROLLED;

  let score = 0;
  const reasons: string[] = [];

  // "A student on their sixth 'not yet' is a student the branch should
  // call" — Student.notStartedCount's own schema comment.
  if (input.notStartedCount >= 6) {
    score += 40;
    reasons.push(`Said "not yet" ${input.notStartedCount} times`);
  } else if (input.notStartedCount >= 3) {
    score += 25;
    reasons.push(`Said "not yet" ${input.notStartedCount} times`);
  } else if (input.notStartedCount >= 1) {
    score += 10;
    reasons.push(`Said "not yet" ${input.notStartedCount} time${input.notStartedCount > 1 ? "s" : ""}`);
  }

  // A brand-new student has no attendance history yet — that is not risk,
  // it is just newness.
  if (hasHistory) {
    if (input.recentAttendance.length === 0) {
      score += 25;
      reasons.push("No attendance recorded in the last 30 days");
    } else {
      const attended = input.recentAttendance.filter(
        (row) => row.present || row.status === "present" || row.status === "late",
      ).length;
      const rate = attended / input.recentAttendance.length;
      if (rate < 0.5) {
        score += 25;
        reasons.push(`Attended only ${attended} of ${input.recentAttendance.length} classes in the last 30 days`);
      } else if (rate < 0.75) {
        score += 10;
        reasons.push(`Attended ${attended} of ${input.recentAttendance.length} classes in the last 30 days`);
      }
    }

    const lastActivityAt = [input.lastVideoActivityAt, input.lastJourneyEventAt]
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const daysSinceActivity = lastActivityAt
      ? Math.floor((now.getTime() - lastActivityAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;

    if (daysSinceActivity === null) {
      score += 20;
      reasons.push("No activity in the portal on record");
    } else if (daysSinceActivity > 21) {
      score += 20;
      reasons.push(`No activity in the portal for ${daysSinceActivity} days`);
    } else if (daysSinceActivity >= 14) {
      score += 10;
      reasons.push(`No activity in the portal for ${daysSinceActivity} days`);
    }
  }

  if (input.behindOnTuition) {
    score += 15;
    reasons.push("Behind on tuition");
  }

  score = Math.min(100, score);
  return { score, level: levelFor(score), reasons };
}

/* -------------------------------------------------------------------------- */
/* Focus preset — same contract as FOCUS_PRESETS in receivables.ts            */
/* -------------------------------------------------------------------------- */

export type ChurnRiskPreset = {
  id: string;
  label: string;
  hint: string;
  tone: "danger" | "warn" | "good" | "info";
  matches: (risk: ChurnRisk) => boolean;
};

export const CHURN_RISK_PRESETS: Record<string, ChurnRiskPreset> = {
  churn_risk: {
    id: "churn_risk",
    label: "Going quiet",
    hint: "High or critical churn risk — attendance, activity, or repeated \"not yet\" answers",
    tone: "warn",
    matches: (risk) => risk.level === "high" || risk.level === "critical",
  },
};

export function churnRiskPreset(id: string | null | undefined): ChurnRiskPreset | null {
  if (!id) return null;
  return CHURN_RISK_PRESETS[id] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Cron entry point                                                           */
/* -------------------------------------------------------------------------- */

/** Monday of the current week, as a date-only string — just needs to change once a week. */
function weekStamp(now: Date): string {
  const day = (now.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/** Exported so callers building their own Prisma `include` (e.g. the admin students route) filter attendance to the same window this module scores against. */
export const RECENT_WINDOW_DAYS = 35;
const FINANCE_LOOKUP_SELECT = {
  id: true,
  level: true,
  status: true,
  classType: true,
  createdAt: true,
  branch: { select: { id: true, name: true } },
  user: { select: { name: true, email: true } },
  payments: {
    // `description` is loaded so `computeStudentFinance` can drop the ₦5,000
    // registration fee in memory — this select is `as const`, which makes a
    // NULL-safe `OR` array unassignable to Prisma's where type.
    where: { status: { in: RECEIVED_PAYMENT_STATUSES } },
    select: { amount: true, createdAt: true, method: true, description: true },
  },
} as const;

/**
 * Notifies each tutor, once, of any of their students showing high/critical
 * churn risk. One aggregated notification per tutor rather than one per
 * student — a tutor with four quiet students gets one message, not four.
 * `dedupeKey` caps it at once per tutor per calendar week regardless of how
 * often the cron ticks.
 */
export async function notifyTutorsOfChurnRisk(now: Date = new Date()): Promise<{
  tutorsNotified: number;
  studentsFlagged: number;
}> {
  const since = new Date(now.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const students = await prisma.student.findMany({
    where: { status: "active", tutorId: { not: null } },
    select: {
      ...FINANCE_LOOKUP_SELECT,
      notStartedCount: true,
      tutorId: true,
      tutor: { select: { userId: true } },
      attendances: {
        where: { date: { gte: since } },
        select: { present: true, status: true },
      },
      videoProgress: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { updatedAt: true },
      },
      journeyEvents: {
        orderBy: { occurredAt: "desc" },
        take: 1,
        select: { occurredAt: true },
      },
    },
  });

  const byTutor = new Map<string, { tutorUserId: string; entries: Array<{ name: string; reasons: string[] }> }>();

  for (const student of students) {
    if (!student.tutor?.userId) continue;

    const finance = computeStudentFinance(student as FinanceStudentInput, now);
    const risk = computeChurnRisk(
      {
        id: student.id,
        createdAt: student.createdAt,
        notStartedCount: student.notStartedCount,
        recentAttendance: student.attendances,
        lastVideoActivityAt: student.videoProgress[0]?.updatedAt ?? null,
        lastJourneyEventAt: student.journeyEvents[0]?.occurredAt ?? null,
        behindOnTuition: finance.behindOnTuition,
      },
      now,
    );

    if (risk.level !== "high" && risk.level !== "critical") continue;

    const bucket = byTutor.get(student.tutorId!) ?? { tutorUserId: student.tutor.userId, entries: [] };
    bucket.entries.push({ name: student.user?.name ?? "A student", reasons: risk.reasons });
    byTutor.set(student.tutorId!, bucket);
  }

  const stamp = weekStamp(now);
  let tutorsNotified = 0;
  let studentsFlagged = 0;

  for (const [tutorId, bucket] of byTutor) {
    studentsFlagged += bucket.entries.length;
    const message = bucket.entries
      .map((entry) => `${entry.name} — ${entry.reasons[0] ?? "showing signs of disengaging"}`)
      .join("; ");

    const result = await notify({
      to: { userIds: [bucket.tutorUserId] },
      kind: KIND.studentAtRisk,
      severity: "warning",
      title: `${bucket.entries.length} student${bucket.entries.length > 1 ? "s" : ""} may need a check-in`,
      message,
      link: "/lecturer/students",
      dedupeKey: `churn-risk:${tutorId}:${stamp}`,
    });

    if (result.created > 0) tutorsNotified += 1;
  }

  return { tutorsNotified, studentsFlagged };
}
