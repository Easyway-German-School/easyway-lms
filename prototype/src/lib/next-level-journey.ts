/**
 * The "your next level" journey — Becca's personalised hand-over from the level
 * a student just finished to the one they could start next.
 *
 * No prisma import. The student page, the admin pipeline and the tests all read
 * these functions, so "who is in this" and "what do we say to them" can never
 * be answered two different ways.
 *
 * HONESTY RULES (same ones the pay-in-full and level-advance work live by):
 *   - Every number on the recap is something this student actually did.
 *     Nothing is rounded up, invented or padded; a thin month gets a thin
 *     recap and an encouraging line, never a fabricated one.
 *   - No invented discount, no invented deadline, no invented scarcity. The
 *     only date shown is the real opening day of the real next intake.
 *   - The balance still open on the level just finished is shown, not hidden.
 *
 * The delight is in the telling — counted-up numbers, a perk reveal, a plan
 * written from their own habits — not in pressure.
 */

import { batchFromAdmission, resolveBatchWindow } from "@/lib/batch";
import { resolveUpcomingBatch } from "@/lib/batch-reservation";
import type { IntakeStartDayOverrides } from "@/lib/intake";
import { LEVELS, nextLevelAfter, sessionDurationMonths } from "@/lib/levels";

/* -------------------------------------------------------------------------- */
/* Who is in it                                                                */
/* -------------------------------------------------------------------------- */

/**
 *  signed_off  the office marked the level finished (`levelCompletedFor`).
 *  promoted    the graduation desk already moved them up; they are waiting for
 *              the new intake to open (portal locked on the countdown).
 *  ended       their batch's teaching months are over and the office has not
 *              signed them off yet — the August cohort the day after it ends.
 *  midway      a month into the level and still teaching — the early invitation
 *              (this is where an October intake lands after its first month).
 */
export type JourneyState = "signed_off" | "promoted" | "ended" | "midway";

/** Days into a level before the early "keep your seat" invitation opens. */
export const MIDWAY_DAYS = 30;

export type JourneyAudience = {
  state: JourneyState;
  /** The level they finished. */
  finishedLevel: string;
  /** The level on offer. */
  targetLevel: string;
};

/** How long after a batch ends the "just finished" welcome keeps coming. */
export const JUST_FINISHED_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

export function previousLevelBefore(level: string): string | null {
  const i = (LEVELS as readonly string[]).indexOf(String(level || "").toUpperCase());
  return i > 0 ? LEVELS[i - 1] : null;
}

export type AudienceInput = {
  level: string;
  levelCompletedFor?: string | null;
  levelCompletedAt?: Date | string | null;
  admission?: unknown;
  classesStartedAt?: Date | string | null;
  createdAt?: Date | string | null;
  sessionSlot?: string | null;
  /** True when the student has at least one present/late attendance mark. */
  hasAttended: boolean;
  startDayOverrides?: IntakeStartDayOverrides;
  now?: Date;
};

/**
 * Does this student get the next-level journey, and from which angle?
 *
 * Returns null for everybody else — including a new student who has not been
 * taught anything. That was the original level-advance bug (congratulating a
 * sign-up on "finishing A1" before their first class), so a student must have
 * attended at least once for the `ended` route to open.
 */
export function resolveJourneyAudience(input: AudienceInput): JourneyAudience | null {
  const now = input.now ?? new Date();
  const level = String(input.level || "A1").toUpperCase();
  const admission =
    input.admission && typeof input.admission === "object" ? (input.admission as Record<string, unknown>) : {};

  // 1. Already moved up by the graduation desk and waiting on the countdown.
  // Promotion stamps `classesStartedAt` with the new intake's opening day, so a
  // start date still in the future is itself proof they are waiting; the batch
  // label is the second opinion for rows where that date was later cleared.
  const futureStart = input.classesStartedAt ? new Date(input.classesStartedAt).getTime() > now.getTime() : false;
  const promoted =
    typeof admission.classesStartedAtBeforePromotion === "string" &&
    (futureStart ||
      resolveUpcomingBatch(batchFromAdmission(admission), {
        registeredAt: input.createdAt,
        classesStartedAt: input.classesStartedAt,
        now,
        startDayOverrides: input.startDayOverrides,
        level,
      }) !== null);
  if (promoted) {
    const finished = previousLevelBefore(level);
    if (finished) return { state: "promoted", finishedLevel: finished, targetLevel: level };
  }

  const target = nextLevelAfter(level);
  if (!target) return null;

  // 2. A human said the level is finished.
  if (input.levelCompletedFor && input.levelCompletedFor.toUpperCase() === level && input.levelCompletedAt) {
    return { state: "signed_off", finishedLevel: level, targetLevel: target };
  }

  // 3. The batch's months are up, and they were actually taught.
  if (input.hasAttended && input.classesStartedAt) {
    const created = input.createdAt ? new Date(input.createdAt) : null;
    const window = resolveBatchWindow(batchFromAdmission(admission), {
      registeredAt: created && !Number.isNaN(created.getTime()) ? created : null,
      now,
      months: sessionDurationMonths(input.sessionSlot),
    });
    if (window && window.hasEnded && now.getTime() - window.endsOn.getTime() <= JUST_FINISHED_DAYS * DAY_MS) {
      return { state: "ended", finishedLevel: level, targetLevel: target };
    }

    // 4. A month in and still teaching: the October intake's turn comes here,
    // not at the door. They get the same journey with "halfway" wording, so a
    // seat can be kept early; nobody is congratulated on finishing something
    // they have not finished.
    const started = new Date(input.classesStartedAt);
    if (
      !Number.isNaN(started.getTime()) &&
      now.getTime() - started.getTime() >= MIDWAY_DAYS * DAY_MS &&
      window &&
      !window.hasEnded
    ) {
      return { state: "midway", finishedLevel: level, targetLevel: target };
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* What they did                                                               */
/* -------------------------------------------------------------------------- */

export type RecapInput = {
  /** Which angle the student is in; only changes the wording. */
  state?: JourneyState;
  firstName: string;
  finishedLevel: string;
  targetLevel: string;
  classesAttended: number;
  classesMarked: number;
  lateCount: number;
  /** Average score 0-100 per grade type ("essay", "quiz", "speaking", ...). */
  gradeAverages: Record<string, number>;
  gradesCount: number;
  videosCompleted: number;
  assignmentsSubmitted: number;
  gamesPlayed: number;
  bestGameStreak: number;
  /** From LearnerBehaviourProfile, all optional — a brand-new profile has none. */
  archetype?: string | null;
  peakHour?: number | null;
  peakWeekday?: number | null;
  longestStreak?: number;
  totalMinutes?: number;
  activeDays?: number;
  goalLabel?: string | null;
  goalDestination?: string | null;
};

export type RecapStat = {
  key: string;
  label: string;
  value: number;
  /** Shown after the counted number: "of 31", "%", "days". */
  suffix?: string;
  note: string;
};

export type PlanCard = {
  key: string;
  title: string;
  detail: string;
  /** Which of their own numbers this was written from. */
  because: string;
};

export type Recap = {
  headline: string;
  /** One-line read of how they learn. */
  rhythmLine: string | null;
  stats: RecapStat[];
  strength: { skill: string; score: number } | null;
  focus: { skill: string; score: number } | null;
  plan: PlanCard[];
  /** True when there was too little data for a flattering story — copy adjusts. */
  thin: boolean;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SKILL_LABEL: Record<string, string> = {
  essay: "writing",
  quiz: "grammar and vocabulary",
  speaking: "speaking",
  pronunciation: "pronunciation",
  exam: "exam papers",
};

/** What each next level actually asks of a learner — true CEFR content. */
export const LEVEL_TEASER: Record<string, { gain: string; topics: string[] }> = {
  A1: { gain: "your first conversations in German", topics: ["Introductions", "Numbers and time", "Everyday needs"] },
  A2: {
    gain: "talk about your past, your plans and daily life",
    topics: ["Talking about the past (Perfekt)", "Dativ and everyday requests", "Work, travel and appointments"],
  },
  B1: {
    gain: "hold your own in real situations — work, forms, phone calls",
    topics: ["Giving opinions and reasons", "Longer texts and emails", "Subordinate clauses with confidence"],
  },
  B2: {
    gain: "study and work in German with fluency",
    topics: ["Argument and debate", "Academic and professional writing", "Nuance and idiom"],
  },
  C1: { gain: "near-native precision", topics: ["Complex texts", "Spontaneous expression", "Exam-level fluency"] },
};

function hourLabel(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "midday";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

/**
 * Turn one student's real numbers into the story Becca tells them.
 *
 * Every plan card names the number it came from (`because`), so the
 * personalisation is checkable — a student who thinks "how does it know that"
 * is shown how, which is the difference between tailored and creepy.
 */
export function buildRecap(input: RecapInput): Recap {
  const name = input.firstName || "there";
  const stats: RecapStat[] = [];

  if (input.classesMarked > 0) {
    stats.push({
      key: "classes",
      label: "Classes attended",
      value: input.classesAttended,
      suffix: `of ${input.classesMarked}`,
      note:
        pct(input.classesAttended, input.classesMarked) >= 90
          ? `${pct(input.classesAttended, input.classesMarked)}% — that is real commitment.`
          : `${pct(input.classesAttended, input.classesMarked)}% of the classes your tutor marked.`,
    });
  }
  if (input.videosCompleted > 0) {
    stats.push({
      key: "videos",
      label: "Lesson videos finished",
      value: input.videosCompleted,
      note: "Watched to the end, not skipped.",
    });
  }
  if (input.assignmentsSubmitted > 0) {
    stats.push({
      key: "assignments",
      label: "Assignments handed in",
      value: input.assignmentsSubmitted,
      note: "Each one is practice you can't get by listening alone.",
    });
  }
  if ((input.longestStreak ?? 0) >= 2) {
    stats.push({
      key: "streak",
      label: "Longest study streak",
      value: input.longestStreak ?? 0,
      suffix: "days",
      note: "Days in a row you showed up.",
    });
  }
  if (input.gamesPlayed > 0) {
    stats.push({
      key: "games",
      label: "Live quiz games played",
      value: input.gamesPlayed,
      note: input.bestGameStreak >= 3 ? `Your best run: ${input.bestGameStreak} correct in a row.` : "Learning that felt like play.",
    });
  }
  if ((input.totalMinutes ?? 0) >= 60) {
    stats.push({
      key: "minutes",
      label: "Hours studying in the portal",
      value: Math.round((input.totalMinutes ?? 0) / 60),
      suffix: "hrs",
      note: "On top of your classes.",
    });
  }

  // Strongest and weakest skill — only with at least two graded skills, and a
  // real gap, otherwise "your weakest skill" is just noise.
  const ranked = Object.entries(input.gradeAverages)
    .filter(([, score]) => Number.isFinite(score))
    .sort((a, b) => b[1] - a[1]);
  const strength =
    ranked.length >= 1 && ranked[0][1] >= 50
      ? { skill: SKILL_LABEL[ranked[0][0]] ?? ranked[0][0], score: Math.round(ranked[0][1]) }
      : null;
  const focus =
    ranked.length >= 2 && ranked[0][1] - ranked[ranked.length - 1][1] >= 8
      ? {
          skill: SKILL_LABEL[ranked[ranked.length - 1][0]] ?? ranked[ranked.length - 1][0],
          score: Math.round(ranked[ranked.length - 1][1]),
        }
      : null;

  // How they learn — one honest sentence, only from a real peak.
  let rhythmLine: string | null = null;
  if (input.peakHour !== null && input.peakHour !== undefined && (input.activeDays ?? 0) >= 5) {
    const day = input.peakWeekday !== null && input.peakWeekday !== undefined ? ` on ${WEEKDAYS[input.peakWeekday]}s` : "";
    rhythmLine = `You do your best work around ${hourLabel(input.peakHour)}${day}.`;
  }

  const plan: PlanCard[] = [];
  const teaser = LEVEL_TEASER[input.targetLevel];

  if (strength) {
    plan.push({
      key: "build",
      title: `Build on your ${strength.skill}`,
      detail: `You averaged ${strength.score}% in ${strength.skill}. ${input.targetLevel} gives you harder material to stretch it.`,
      because: `${strength.skill} average ${strength.score}%`,
    });
  }
  if (focus) {
    plan.push({
      key: "focus",
      title: `A little extra on ${focus.skill}`,
      detail: `${focus.skill[0].toUpperCase()}${focus.skill.slice(1)} was your lighter area (${focus.score}%). Your ${input.targetLevel} practice plan leans into it early.`,
      because: `${focus.skill} average ${focus.score}%`,
    });
  }

  const archetypePlan: Record<string, { title: string; detail: string }> = {
    night_owl: { title: "An evening sitting suits you", detail: "You study late. Ask for the evening class, and your reminders will come at night, not morning." },
    early_bird: { title: "A morning sitting suits you", detail: "You are on before the day starts. The morning class puts your best hours in the classroom." },
    lunch_breaker: { title: "Short, midday practice", detail: "You study in bursts around work. Your missions stay short and fit a lunch break." },
    weekend_crammer: { title: "Weekend-friendly pacing", detail: "You do your week's work on Saturday and Sunday. We will keep a weekend revision block ready for you." },
    clockwork: { title: "Keep your exact rhythm", detail: "Same hour, same days — you are the easiest learner to plan for. Your slot and tutor stay the same." },
    grinder: { title: "A stretch track", detail: "You put in heavy, consistent time. Expect optional stretch tasks in the next level." },
    social: { title: "Study with your people", detail: "You are at your best with classmates. Your cohort moves up together, so the community comes with you." },
    binger: { title: "Deep-dive lessons", detail: "You learn in long sittings. Longer lesson blocks and video series are the format for you." },
    skimmer: { title: "Bite-size daily missions", detail: "Short and frequent works for you. Your next level opens with one-minute daily missions." },
    steady: { title: "Same steady pace", detail: "Regular and reliable. You will carry the same rhythm straight into the next level." },
  };
  const arch = input.archetype ? archetypePlan[input.archetype] : null;
  if (arch) {
    plan.push({
      key: "rhythm",
      title: arch.title,
      detail: arch.detail,
      because: input.archetype === "night_owl" || input.archetype === "early_bird" ? "when you study" : "how you study",
    });
  }

  if (input.goalLabel) {
    plan.push({
      key: "goal",
      title: input.goalDestination ? `One step closer to ${input.goalDestination}` : "One step closer to your goal",
      detail: `You told us you are learning German for: ${input.goalLabel.toLowerCase()}. ${input.targetLevel} is the next rung on that road.`,
      because: "the goal you set",
    });
  }

  if (teaser) {
    plan.push({
      key: "next",
      title: `${input.targetLevel}: ${teaser.gain}`,
      detail: teaser.topics.join(" · "),
      because: `what ${input.targetLevel} covers`,
    });
  }

  const thin = stats.length < 2;
  // Halfway wording never says "done" — that level is still running.
  const midway = input.state === "midway";
  const headline = midway
    ? thin
      ? `${name}, you are a month into ${input.finishedLevel}. Here is what comes after.`
      : `${name}, look what you did in your first month of ${input.finishedLevel}.`
    : thin
      ? `${name}, ${input.finishedLevel} is done. Here is what comes next.`
      : `${name}, look what you did in ${input.finishedLevel}.`;

  return { headline, rhythmLine, stats: stats.slice(0, 4), strength, focus, plan: plan.slice(0, 4), thin };
}

/* -------------------------------------------------------------------------- */
/* Their answer                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the student has told us so far, stored on `admission.nextLevel` — the
 * admin already reads that blob everywhere, so no migration and the office sees
 * it on the dossier straight away.
 *
 *   seen   opened the journey
 *   held   gave their details and asked us to keep their seat
 *
 * "Paid" is never stored here: the ledger is the only source of truth for money.
 */
export type NextLevelIntent = {
  targetLevel: string;
  seenAt?: string;
  heldAt?: string;
  details?: {
    phone?: string;
    parentPhone?: string;
    /** morning | afternoon | evening | weekend */
    sessionSlot?: string;
    /** physical | online | hybrid */
    deliveryMode?: string;
    note?: string;
  };
};

export type JourneyStage = "not_opened" | "opened" | "held" | "deposit_paid" | "paid_in_full";

export const STAGE_LABEL: Record<JourneyStage, string> = {
  not_opened: "Hasn't opened it yet",
  opened: "Opened the journey",
  held: "Details in — holding a seat",
  deposit_paid: "Deposit paid",
  paid_in_full: "Paid in full",
};

export function stageFor(intent: NextLevelIntent | null, seat: "none" | "deposit" | "full"): JourneyStage {
  if (seat === "full") return "paid_in_full";
  if (seat === "deposit") return "deposit_paid";
  if (intent?.heldAt) return "held";
  if (intent?.seenAt) return "opened";
  return "not_opened";
}

export function readIntent(admission: unknown, targetLevel: string): NextLevelIntent | null {
  if (!admission || typeof admission !== "object") return null;
  const raw = (admission as Record<string, unknown>).nextLevel;
  if (!raw || typeof raw !== "object") return null;
  const intent = raw as NextLevelIntent;
  // An intent about A2 must not carry over when they are later offered B1.
  return String(intent.targetLevel || "").toUpperCase() === targetLevel.toUpperCase() ? intent : null;
}

const SLOTS = ["morning", "afternoon", "evening", "weekend"];
const MODES = ["physical", "online", "hybrid"];

/** Trim, bound and whitelist what a browser sends. Never trust the body. */
export function cleanDetails(raw: unknown): NonNullable<NextLevelIntent["details"]> {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
  const phone = (value: unknown) => {
    const v = text(value, 20);
    return v && /^[+\d][\d\s-]{6,}$/.test(v) ? v : undefined;
  };
  const slot = typeof body.sessionSlot === "string" ? body.sessionSlot.toLowerCase() : "";
  const mode = typeof body.deliveryMode === "string" ? body.deliveryMode.toLowerCase() : "";
  return {
    phone: phone(body.phone),
    parentPhone: phone(body.parentPhone),
    sessionSlot: SLOTS.includes(slot) ? slot : undefined,
    deliveryMode: MODES.includes(mode) ? mode : undefined,
    note: text(body.note, 500),
  };
}
