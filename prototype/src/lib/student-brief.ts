import { prisma } from "@/lib/prisma";
import { calculateStreak } from "@/lib/gamification";
import { cached } from "@/lib/ai-cache";
import { callModel, activeModelName } from "@/lib/ai";
import { profileFor } from "@/lib/learner-intelligence";
import type { StudentAccess } from "@/lib/access";
import { receivedPaymentFilter } from "@/lib/payment";
import { accessFromStudent } from "@/lib/student-access";
import { planStatusForStudent, planSuppressesLock } from "@/lib/payment-plans";
import { schoolDayStart } from "@/lib/school-time";
import { studentIdsSilenced } from "@/lib/fee-reminder-settings";
import { goalFor, isKnownGoal } from "@/lib/germany-goals";
import { schoolCalendarParts } from "@/lib/month-dump-window";

export { isMonthDumpWindow, schoolCalendarParts } from "@/lib/month-dump-window";

/**
 * Becca's brief — daily / weekly / monthly, hosted rather than generated.
 *
 * The FACTS are deliberately NOT a model call. Anthropic's own "morning
 * brief" can afford one because it's reading a single account's history once
 * a day; this school would be paying for one generation per student per
 * period, and the thing a brief actually needs — specific, correct numbers —
 * is exactly what a small model is worst at and a database query is best at.
 * Every number below is a real query scoped to the period; the sentences
 * wrapping them are pure functions, the same trick `scoreline()` in the
 * Kahoot result screen already uses.
 *
 * ONE line is a real model call: `personalLine`. The numbers can't be wrong
 * because a model never states them — it's handed them as already-true facts
 * plus a behaviour summary from the engine in learner-intelligence.ts (peak
 * hours, rhythm, archetype — the per-student data the school already
 * collects and otherwise only an admin ever sees) and asked to write ONE
 * sentence of framing around them. Cached per student per period per day, so
 * a student re-checking their brief five times doesn't cost five calls.
 *
 * The month dump (`buildMonthDump`) is the richer sibling: calendar-month
 * window, assignments, community, video progress, Germany journey — still
 * deterministic facts, still one optional Becca sentence.
 */

export type BriefPeriod = "daily" | "weekly" | "monthly";

/**
 * The tuition-balance nudge for a part-payer. Becca surfaces it every day (the
 * brief is daily) until the balance is cleared. Null for everyone who has paid
 * in full or is still registration-only.
 */
export type PaymentNote = {
  /** Still owed against the full fee. */
  outstanding: number;
  /** ISO date access pauses (or an admin grace date, if one is set and still ahead). */
  lockDate: string;
  daysToLock: number;
  /** Within a week of the lock — render it louder. */
  urgent: boolean;
  /** The lock has already landed (the student is seeing this through a still-open page). */
  locked: boolean;
  graceUntil: string | null;
};

export type BriefSuggestion = {
  label: string;
  blurb: string;
  href: string;
};

export type Brief = {
  period: BriefPeriod;
  headline: string;
  lines: string[];
  /** Becca's own line, from Claude — null when unfunded/unreachable. Never a fact, just framing. */
  personalNote: string | null;
  /** Tuition-balance reminder for a part-payer — null otherwise. */
  paymentNote: PaymentNote | null;
  /** Concrete next steps when we have enough signal — empty for a quiet day. */
  suggestions: BriefSuggestion[];
};

export type MonthDumpStats = {
  lessons: number;
  quizzes: number;
  missions: number;
  assignments: number;
  communityPosts: number;
  videosCompleted: number;
  videosInProgress: number;
};

export type MonthDumpJourney = {
  level: string | null;
  goalLabel: string | null;
  pathway: string | null;
  daysInClass: number | null;
  stampsCount: number;
};

export type MonthDump = Brief & {
  monthLabel: string;
  year: number;
  stats: MonthDumpStats;
  journey: MonthDumpJourney;
};

function periodStart(period: BriefPeriod, now = new Date()): Date {
  const start = schoolDayStart(now);
  if (period === "daily") return start;
  start.setUTCDate(start.getUTCDate() - (period === "weekly" ? 6 : 29));
  return start;
}

/** First instant of the current school-calendar month (approx via noon UTC on the 1st). */
function calendarMonthStart(now = new Date()): Date {
  const { year, month } = schoolCalendarParts(now);
  return schoolDayStart(new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)));
}

const PERIOD_WORD: Record<BriefPeriod, string> = {
  daily: "today",
  weekly: "this week",
  monthly: "this month",
};

async function loadStudentForBrief(userId: string) {
  return prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      examReadiness: true,
      level: true,
      classType: true,
      pathway: true,
      createdAt: true,
      classesStartedAt: true,
      paymentGraceUntil: true,
      admission: true,
      deliveryMode: true,
      germanyGoal: true,
      germanyGoalNote: true,
      journeyStages: true,
      branch: { select: { name: true, mode: true } },
      user: { select: { name: true } },
      attendances: { select: { date: true, present: true, status: true } },
      payments: { where: { ...receivedPaymentFilter(), deletedAt: null }, select: { amount: true } },
      tuitionCharges: {
        where: { deletedAt: null },
        select: {
          id: true,
          level: true,
          amount: true,
          waivedAmount: true,
          legacyArrears: true,
          historyStatus: true,
          historicalPaidAmount: true,
          createdAt: true,
          settledAt: true,
        },
      },
    },
  });
}

async function activityCounts(studentId: string, userId: string, since: Date) {
  const [lessonsDone, quizzesPlayed, missionsDone, assignmentsDone, communityPosts, videosCompleted, videosInProgress] =
    await Promise.all([
      prisma.completion.count({
        where: { studentId, status: "completed", completedAt: { gte: since } },
      }),
      prisma.quizGamePlayer.count({
        where: { studentId, joinedAt: { gte: since }, answered: { gt: 0 } },
      }),
      prisma.dailyMission.count({ where: { userId, done: true, updatedAt: { gte: since } } }),
      prisma.assignmentSubmission.count({
        where: { studentId, submittedAt: { gte: since } },
      }),
      prisma.message.count({
        where: { authorId: userId, createdAt: { gte: since }, hiddenAt: null },
      }),
      prisma.videoProgress.count({
        where: { studentId, completed: true, updatedAt: { gte: since } },
      }),
      prisma.videoProgress.count({
        where: {
          studentId,
          completed: false,
          positionSeconds: { gt: 30 },
          updatedAt: { gte: since },
        },
      }),
    ]);

  return {
    lessonsDone,
    quizzesPlayed,
    missionsDone,
    assignmentsDone,
    communityPosts,
    videosCompleted,
    videosInProgress,
  };
}

function stampsCount(journeyStages: unknown): number {
  if (!journeyStages || typeof journeyStages !== "object") return 0;
  return Object.keys(journeyStages as Record<string, unknown>).length;
}

function daysInClass(classesStartedAt: Date | null, now = new Date()): number | null {
  if (!classesStartedAt) return null;
  const ms = now.getTime() - classesStartedAt.getTime();
  if (ms < 0) return 0;
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

function buildSuggestions(input: {
  assignmentsDone: number;
  communityPosts: number;
  videosInProgress: number;
  videosCompleted: number;
  missionsDone: number;
  germanyGoal: string | null;
  level: string | null;
  period: BriefPeriod;
}): BriefSuggestion[] {
  const out: BriefSuggestion[] = [];

  if (input.videosInProgress > 0) {
    out.push({
      label: "Finish a video you started",
      blurb: `${input.videosInProgress} still open — pick one up where you left it.`,
      href: "/materials",
    });
  } else if (input.videosCompleted === 0 && input.period !== "daily") {
    out.push({
      label: "Watch a class tape",
      blurb: "Missed a day? Your recordings are waiting on Materials.",
      href: "/materials",
    });
  }

  if (input.assignmentsDone === 0) {
    out.push({
      label: "Hand in an assignment",
      blurb: "Even one submission this month moves your mark book.",
      href: "/assignment",
    });
  }

  if (input.communityPosts === 0) {
    out.push({
      label: "Say something in Community",
      blurb: "Ask a question or share a win — your branch is listening.",
      href: "/community",
    });
  }

  if (!input.germanyGoal) {
    out.push({
      label: "Tell Becca why German",
      blurb: "One tap redraws your road to Germany around your real goal.",
      href: "/dashboard",
    });
  } else {
    out.push({
      label: "Check your Germany road",
      blurb: input.level
        ? `You're on ${input.level} — see how far the map has moved.`
        : "Stamp a stage or just look at how far you've come.",
      href: "/dashboard",
    });
  }

  out.push({
    label: "Play a word puzzle",
    blurb: "Wortbau and Wortsuche — quick German practice that doesn't feel like homework.",
    href: "/games",
  });

  return out.slice(0, 3);
}

export async function buildBrief(userId: string, period: BriefPeriod): Promise<Brief | null> {
  const student = await loadStudentForBrief(userId);
  if (!student) return null;

  const planStatus = await planStatusForStudent(student.id);
  const access = accessFromStudent(student, planSuppressesLock(planStatus?.adherence ?? null));

  const since = periodStart(period);
  const firstName = (student.user?.name ?? "").trim().split(/\s+/)[0] || "";

  const counts = await activityCounts(student.id, userId, since);

  const presentDays = student.attendances.filter(
    (a) => a.present || a.status === "present" || a.status === "late",
  );
  const streak = calculateStreak(presentDays.map((a) => a.date));

  const activityCount = counts.lessonsDone + counts.quizzesPlayed + counts.missionsDone;
  const greeting = firstName ? `${firstName}, ` : "";

  const headline =
    activityCount === 0
      ? `${greeting}nothing logged ${PERIOD_WORD[period]} yet — that's the easiest thing on this page to fix.`
      : period === "daily"
        ? `${greeting}here's today: ${describeActivity(counts.lessonsDone, counts.quizzesPlayed, counts.missionsDone)}.`
        : `${greeting}here's ${PERIOD_WORD[period]}: ${describeActivity(counts.lessonsDone, counts.quizzesPlayed, counts.missionsDone)}.`;

  const lines: string[] = [];
  if (streak >= 2) lines.push(`${streak}-day streak — don't be the one who breaks it.`);
  if (student.examReadiness >= 70) lines.push(`Exam readiness is at ${student.examReadiness}%. You could sit this and be fine.`);
  else if (student.examReadiness > 0) lines.push(`Exam readiness: ${student.examReadiness}%. Still climbing.`);

  if (period !== "daily") {
    if (counts.assignmentsDone > 0) {
      lines.push(
        `${counts.assignmentsDone} assignment${counts.assignmentsDone === 1 ? "" : "s"} submitted ${PERIOD_WORD[period]}.`,
      );
    }
    if (counts.communityPosts > 0) {
      lines.push(
        `${counts.communityPosts} community message${counts.communityPosts === 1 ? "" : "s"} — you showed up for the group.`,
      );
    }
    if (counts.videosCompleted > 0 || counts.videosInProgress > 0) {
      const bits: string[] = [];
      if (counts.videosCompleted > 0) bits.push(`${counts.videosCompleted} video${counts.videosCompleted === 1 ? "" : "s"} finished`);
      if (counts.videosInProgress > 0) bits.push(`${counts.videosInProgress} still in progress`);
      lines.push(bits.join(", ") + ".");
    }
    if (student.level) {
      const goal = isKnownGoal(student.germanyGoal) ? goalFor(student.germanyGoal) : null;
      lines.push(
        goal
          ? `You're on ${student.level} — ${goal.label.replace(/^I am /, "heading to ").replace(/\.$/, "")}.`
          : `You're studying at ${student.level}.`,
      );
    }
  }

  if (activityCount > 0 && period !== "daily") lines.push(closingLine(activityCount, period));

  const personalNote = await personalLine(userId, period, {
    firstName,
    streak,
    examReadiness: student.examReadiness,
    activityCount,
    activitySummary: describeActivity(counts.lessonsDone, counts.quizzesPlayed, counts.missionsDone),
    extra: period === "monthly"
      ? [
          counts.assignmentsDone ? `${counts.assignmentsDone} assignments` : "",
          counts.communityPosts ? `${counts.communityPosts} community posts` : "",
          student.level ? `level ${student.level}` : "",
          student.germanyGoal && isKnownGoal(student.germanyGoal) ? goalFor(student.germanyGoal).label : "",
        ]
          .filter(Boolean)
          .join("; ")
      : "",
  }).catch(() => null);

  const beccaSilenced = (await studentIdsSilenced("becca", [student.id])).has(student.id);

  const suggestions = buildSuggestions({
    assignmentsDone: counts.assignmentsDone,
    communityPosts: counts.communityPosts,
    videosInProgress: counts.videosInProgress,
    videosCompleted: counts.videosCompleted,
    missionsDone: counts.missionsDone,
    germanyGoal: student.germanyGoal,
    level: student.level,
    period,
  });

  return {
    period,
    headline,
    lines,
    personalNote,
    paymentNote: beccaSilenced ? null : buildPaymentNote(access),
    suggestions,
  };
}

/**
 * Calendar-month dump Becca hosts near month-end. Same fact discipline as
 * buildBrief — richer sections for the popup and the monthly dashboard tab.
 */
export async function buildMonthDump(userId: string, now = new Date()): Promise<MonthDump | null> {
  const student = await loadStudentForBrief(userId);
  if (!student) return null;

  const { year, monthLabel } = schoolCalendarParts(now);
  const since = calendarMonthStart(now);
  const firstName = (student.user?.name ?? "").trim().split(/\s+/)[0] || "";

  const planStatus = await planStatusForStudent(student.id);
  const access = accessFromStudent(student, planSuppressesLock(planStatus?.adherence ?? null));

  const counts = await activityCounts(student.id, userId, since);

  const presentDays = student.attendances.filter(
    (a) => a.present || a.status === "present" || a.status === "late",
  );
  const streak = calculateStreak(presentDays.map((a) => a.date));

  const activityCount =
    counts.lessonsDone +
    counts.quizzesPlayed +
    counts.missionsDone +
    counts.assignmentsDone +
    counts.communityPosts +
    counts.videosCompleted;

  const greeting = firstName ? `${firstName}, ` : "";
  const headline =
    activityCount === 0
      ? `${greeting}your ${monthLabel} dump is quiet so far — still time to leave a mark.`
      : `${greeting}here's your ${monthLabel}: ${describeRichActivity(counts)}.`;

  const journey: MonthDumpJourney = {
    level: student.level,
    goalLabel: isKnownGoal(student.germanyGoal) ? goalFor(student.germanyGoal).label : null,
    pathway: student.pathway,
    daysInClass: daysInClass(student.classesStartedAt, now),
    stampsCount: stampsCount(student.journeyStages),
  };

  const lines: string[] = [];
  if (journey.level) {
    lines.push(
      journey.goalLabel
        ? `${journey.level} · ${journey.goalLabel}`
        : `Studying at ${journey.level}${journey.pathway ? ` · ${journey.pathway}` : ""}.`,
    );
  }
  if (journey.daysInClass != null) {
    lines.push(
      journey.daysInClass === 1
        ? "Day one with the school — welcome."
        : `${journey.daysInClass} days with EasyWay so far.`,
    );
  }
  if (journey.stampsCount > 0) {
    lines.push(`${journey.stampsCount} stage${journey.stampsCount === 1 ? "" : "s"} stamped on your Germany road.`);
  }
  if (streak >= 2) lines.push(`${streak}-day streak — keep it through month-end.`);
  if (student.examReadiness > 0) lines.push(`Exam readiness: ${student.examReadiness}%.`);
  if (activityCount > 0) lines.push(closingLine(activityCount, "monthly"));

  const personalNote = await personalLine(userId, "monthly", {
    firstName,
    streak,
    examReadiness: student.examReadiness,
    activityCount,
    activitySummary: describeRichActivity(counts),
    extra: [
      `Month: ${monthLabel}`,
      journey.level ? `Level ${journey.level}` : "",
      journey.goalLabel ?? "",
      journey.daysInClass != null ? `${journey.daysInClass} days at school` : "",
    ]
      .filter(Boolean)
      .join("; "),
  }).catch(() => null);

  const beccaSilenced = (await studentIdsSilenced("becca", [student.id])).has(student.id);

  const suggestions = buildSuggestions({
    assignmentsDone: counts.assignmentsDone,
    communityPosts: counts.communityPosts,
    videosInProgress: counts.videosInProgress,
    videosCompleted: counts.videosCompleted,
    missionsDone: counts.missionsDone,
    germanyGoal: student.germanyGoal,
    level: student.level,
    period: "monthly",
  });

  return {
    period: "monthly",
    monthLabel,
    year,
    headline,
    lines,
    personalNote,
    paymentNote: beccaSilenced ? null : buildPaymentNote(access),
    suggestions,
    stats: {
      lessons: counts.lessonsDone,
      quizzes: counts.quizzesPlayed,
      missions: counts.missionsDone,
      assignments: counts.assignmentsDone,
      communityPosts: counts.communityPosts,
      videosCompleted: counts.videosCompleted,
      videosInProgress: counts.videosInProgress,
    },
    journey,
  };
}

function buildPaymentNote(access: StudentAccess): PaymentNote | null {
  const depositMet = access.progressPercent >= 100;
  const fullyPaid = access.outstandingBalance <= 0;
  if (!depositMet || fullyPaid) return null;

  const dayMs = 24 * 60 * 60 * 1000;
  const graceUntil = access.graceUntil ? new Date(access.graceUntil) : null;
  const graceActive = graceUntil ? Date.now() < graceUntil.getTime() : false;
  const lockAt = access.lockAt ? new Date(access.lockAt) : null;
  const effectiveLockAt = graceActive && graceUntil ? graceUntil : lockAt;
  if (!effectiveLockAt) return null;
  const daysToLock = Math.ceil((effectiveLockAt.getTime() - Date.now()) / dayMs);

  return {
    outstanding: access.outstandingBalance,
    lockDate: effectiveLockAt.toISOString(),
    daysToLock,
    urgent: daysToLock <= 7,
    locked: !access.hasAccess && access.lockReason === "unsettled_balance",
    graceUntil: graceUntil ? graceUntil.toISOString() : null,
  };
}

async function personalLine(
  userId: string,
  period: BriefPeriod,
  facts: {
    firstName: string;
    streak: number;
    examReadiness: number;
    activityCount: number;
    activitySummary: string;
    extra?: string;
  },
): Promise<string | null> {
  const day = new Date().toISOString().slice(0, 10);

  let behaviour: string;
  try {
    behaviour = (await profileFor(userId, facts.firstName || undefined)).summary;
  } catch {
    behaviour = "";
  }

  const input = `${userId}:${period}:${day}:v2:${facts.extra ?? ""}`;
  return cached<string>(
    "student_brief_line",
    input,
    async () => {
      const prompt = [
        `You are Becca, a warm but no-nonsense mascot for a Nigerian German-language school, writing ONE sentence`,
        `for a student's ${period} brief. This is framing only — every fact you use MUST come from what's given below;`,
        `never invent a number, a streak, or an activity that isn't listed.`,
        "",
        `Student: ${facts.firstName || "the student"}`,
        `${period} so far: ${facts.activitySummary} (${facts.activityCount} total actions)`,
        `Current streak: ${facts.streak} day(s)`,
        `Exam readiness: ${facts.examReadiness}%`,
        facts.extra ? `More context: ${facts.extra}` : "",
        behaviour ? `What we know about how they use the app: ${behaviour}` : "",
        "",
        "Write exactly one short sentence (under 25 words), in Becca's voice: warm, direct, a little playful, never",
        "corporate. No emoji. No quotation marks. Reply with ONLY the sentence.",
      ]
        .filter(Boolean)
        .join("\n");

      const raw = await callModel(prompt, 100, "student");
      if (!raw) return null;
      const clean = raw.trim().replace(/^["']|["']$/g, "").slice(0, 220);
      return clean || null;
    },
    { model: activeModelName() },
  );
}

function describeActivity(lessons: number, quizzes: number, missions: number): string {
  const parts: string[] = [];
  if (lessons > 0) parts.push(`${lessons} lesson${lessons === 1 ? "" : "s"} finished`);
  if (quizzes > 0) parts.push(`${quizzes} quiz game${quizzes === 1 ? "" : "s"} played`);
  if (missions > 0) parts.push(`${missions} quest${missions === 1 ? "" : "s"} cleared`);
  if (parts.length === 0) return "quiet, but the day isn't over";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function describeRichActivity(counts: Awaited<ReturnType<typeof activityCounts>>): string {
  const parts: string[] = [];
  if (counts.lessonsDone > 0) parts.push(`${counts.lessonsDone} lesson${counts.lessonsDone === 1 ? "" : "s"}`);
  if (counts.assignmentsDone > 0) parts.push(`${counts.assignmentsDone} assignment${counts.assignmentsDone === 1 ? "" : "s"}`);
  if (counts.videosCompleted > 0) parts.push(`${counts.videosCompleted} video${counts.videosCompleted === 1 ? "" : "s"} watched`);
  if (counts.quizzesPlayed > 0) parts.push(`${counts.quizzesPlayed} quiz game${counts.quizzesPlayed === 1 ? "" : "s"}`);
  if (counts.communityPosts > 0) parts.push(`${counts.communityPosts} community post${counts.communityPosts === 1 ? "" : "s"}`);
  if (counts.missionsDone > 0) parts.push(`${counts.missionsDone} quest${counts.missionsDone === 1 ? "" : "s"}`);
  if (parts.length === 0) return "a quiet month so far";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function closingLine(activityCount: number, period: BriefPeriod): string {
  if (period === "monthly") {
    if (activityCount >= 20) return "That's a month with real weight behind it.";
    if (activityCount >= 8) return "Steady month. A little more and it's a strong one.";
    return "A light month — worth picking the pace back up.";
  }
  if (activityCount >= 8) return "Best week in a while.";
  if (activityCount >= 3) return "Solid week.";
  return "A quiet week — nothing that can't be caught up.";
}
