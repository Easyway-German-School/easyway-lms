/**
 * WHAT KIND OF LEARNER THIS IS — pure functions, no database.
 *
 * Sibling to `learner-signals.ts`, and it keeps the same two rules:
 *
 *  1. NOTHING HERE INVENTS A FACT. Every number traces to lessons the student
 *     actually opened, videos they actually watched, work they actually
 *     submitted. Where the evidence is thin the answer is "thin" — a null
 *     affinity, `confidence: "thin"` — never a confident-looking 0.5 that the
 *     planner would then steer a real plan by.
 *
 *  2. NO PRISMA IMPORT, EVER. This is the part a unit test has to be able to
 *     reach without a database, because a personalisation weight that silently
 *     drifts hands every student a subtly worse plan and nobody notices.
 *
 * WHERE `learner-signals.ts` ENDS AND THIS BEGINS. That file reads *rhythm* —
 * when someone studies, how long a sitting is, whether they are drifting away.
 * This file reads *taste* — which format they finish, which length they
 * abandon, whether they push through a hard lesson or bail. The planner
 * (`generatePersonalizedPlan` in ai.ts) already weights the academic axis
 * (weakest skill, exam readiness, difficulty). Taste is the axis it was
 * missing, and this is the whole of it.
 *
 * THIS IS WEIGHTING, NOT FILTERING. A student weak in listening still gets
 * listening work even if every number here says they would rather watch a
 * video. `styleAdjustment` returns a BOUNDED delta on purpose — it can nudge a
 * lesson up or down the queue, it can never remove a lesson the academic
 * scorer put there.
 */

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/** One lesson this student has at least started. */
export type LessonTouch = {
  lessonId: string;
  /** "lesson" | "quiz" | "assignment" | "discussion" — Lesson.type. */
  type: string;
  /** "started" | "in_progress" | "completed" — Completion.status. */
  status: string;
  startedAt: Date | string;
  completedAt: Date | string | null;
  /** The lesson's own nominal `duration`, in minutes. Null on older rows. */
  nominalMinutes: number | null;
  /** Completion.score, 0-100, when the lesson carried one. */
  score: number | null;
  /** CEFR level of the lesson (or its course): "A1".."C2". Null if unknown. */
  level: string | null;
};

/** One piece of graded work. Grade.type ∈ essay | quiz | speaking | pronunciation | exam. */
export type GradeTouch = { type: string; score: number; at: Date | string };

/** One watch-library video and how far into it the student got. */
export type VideoTouch = {
  completed: boolean;
  positionSeconds: number;
  durationSeconds: number | null;
  at: Date | string;
};

/**
 * The rhythm half, lifted straight off `LearnerBehaviourProfile` so this file
 * never has to recompute it. Null for a learner with no behaviour profile yet.
 */
export type Rhythm = {
  avgSessionMinutes: number;
  /** From `bestHours()` in learner-signals.ts — the learner's own clock. */
  bestHours: number[];
  archetype: string;
  /**
   * Share of measured attention per coarse surface, e.g.
   * `{ lessons: 0.5, watch: 0.2, play: 0.1, community: 0.2 }`. Keys are the
   * first path segment, exactly as `LearnerUsageEvent.area` stores them.
   */
  surfaceShare: Record<string, number>;
} | null;

/**
 * What the student told us at signup, before there was anything to observe.
 * The cold-start seed — see /api/student/learning-preferences. Every field
 * optional: a student can answer one question and skip the other.
 */
export type StyleSeed = {
  /** "watch" | "read" | "practice" | "mixed" */
  format?: string | null;
  /** "short" | "standard" | "deep" */
  pace?: string | null;
} | null;

export type StyleInputs = {
  lessonTouches: LessonTouch[];
  grades: GradeTouch[];
  videos: VideoTouch[];
  rhythm: Rhythm;
  seed: StyleSeed;
  /** The student's current CEFR level, for the difficulty-grit reading. */
  studentLevel: string | null;
};

/* -------------------------------------------------------------------------- */
/* Output                                                                      */
/* -------------------------------------------------------------------------- */

export type FormatKey = "lesson" | "quiz" | "assignment" | "discussion" | "video";

export const FORMAT_KEYS: FormatKey[] = ["lesson", "quiz", "assignment", "discussion", "video"];

export type ConfidenceTier = "none" | "seed" | "thin" | "fair" | "strong";

export type LearningStyle = {
  /**
   * How much this reading is worth leaning on. The planner scales every style
   * adjustment by this — a "thin" profile barely moves the queue, a "strong"
   * one shapes it.
   *
   *  none   nothing observed and nothing said. Plan on academics alone.
   *  seed   no behaviour yet, but the learner picked a preference at signup.
   *  thin   a handful of data points. Nudge, do not steer.
   *  fair   enough of a habit to shape the plan.
   *  strong a settled habit. Trust it.
   */
  confidence: ConfidenceTier;
  /** Lesson starts + video views + graded pieces behind this reading. */
  evidenceCount: number;
  /**
   * Appetite for each format, 0..1, each on ITS OWN axis — they do not sum to
   * 1, because "likes quizzes" and "likes videos" are not in competition.
   * `null` where there is no evidence for that format at all.
   */
  formatAffinity: Record<FormatKey, number | null>;
  /** 0..1 — of everything they start, how much do they finish. Null if nothing started. */
  followThrough: number | null;
  /**
   * The lesson length, in minutes, this learner completes most reliably —
   * clamped down to their typical sitting so a single finished 40-minute
   * lesson does not become a recommendation to a 9-minute-sitting student.
   * Null if unknown.
   */
  sweetSpotMinutes: number | null;
  sessionShape: "micro" | "short" | "standard" | "deep" | null;
  /** Hours of the learner's day to put the heavier lesson in, best first. */
  bestHours: number[];
  /**
   * 0..1 — of the lessons pitched ABOVE their level that they started, how
   * many did they finish. Low means stretch content gets abandoned; high
   * means they push through. Null until they have tried at least two.
   */
  difficultyGrit: number | null;
  /** One plain line a student could read. "" when confidence is "none". */
  summary: string;
};

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

const CEFR_RANK: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

/** Mirrors `mapLevelToRank` in ai.ts. Unknown / missing → A2, the median start. */
export function levelRank(level: string | null | undefined): number {
  return CEFR_RANK[String(level || "").toUpperCase()] || 2;
}

function asTime(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime();
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function shapeFor(minutes: number | null): LearningStyle["sessionShape"] {
  if (minutes === null) return null;
  if (minutes <= 8) return "micro";
  if (minutes <= 18) return "short";
  if (minutes <= 35) return "standard";
  return "deep";
}

/**
 * A `LearnerUsageEvent.area` (a first path segment) mapped to the lesson
 * format that surface represents. Voluntary time on the watch library is
 * evidence of a taste for video even before a single video is finished; time
 * in the quiz game likewise for quizzes. Surfaces with no format meaning
 * (dashboard, community, settings) return null and are ignored.
 */
function surfaceToFormat(area: string): FormatKey | null {
  const a = area.toLowerCase();
  if (a === "watch" || a === "videos" || a === "library") return "video";
  if (a === "play" || a === "quiz" || a === "games" || a === "practice") return "quiz";
  if (a === "assignments" || a === "assignment") return "assignment";
  if (a === "community" || a === "forum") return "discussion";
  if (a === "lesson" || a === "lessons" || a === "learn" || a === "course" || a === "courses") return "lesson";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Evidence thresholds                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Below THIN, there is not enough to say anything at all from behaviour — the
 * seed takes over if there is one. THIN..FAIR is a nudge. FAIR..STRONG shapes
 * the plan. At or above STRONG the habit is settled. The numbers are lesson
 * starts + videos + graded pieces, and they are deliberately low: a fortnight
 * of ordinary use clears FAIR, which is the point at which a plan that ignored
 * taste would start to feel wrong.
 */
export const EVIDENCE = { thin: 3, fair: 8, strong: 20 } as const;

function tierFor(count: number): Exclude<ConfidenceTier, "seed" | "none"> | "none" {
  if (count >= EVIDENCE.strong) return "strong";
  if (count >= EVIDENCE.fair) return "fair";
  if (count >= EVIDENCE.thin) return "thin";
  return "none";
}

/* -------------------------------------------------------------------------- */
/* Format affinity                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One format's affinity, 0..1, or null if there is nothing to go on.
 *
 * Three ingredients, because each answers a different question and any one of
 * them alone misleads:
 *
 *   completion  of the lessons of this format they STARTED, how many did they
 *               finish. The strongest signal — a student who opens every quiz
 *               and finishes none does not like quizzes, whatever they clicked.
 *   pull        how much of their voluntary surface time lands on the matching
 *               surface (watch library → video, quiz game → quiz). This is the
 *               only ingredient available before anything is completed, so it
 *               carries the cold-start weeks.
 *   scoreLift   when the format is graded, whether they do BETTER at it than
 *               their own average. Enjoying a thing and being good at it are
 *               not the same, but they correlate, and a student who scores 15
 *               points higher on writing than on everything else is telling us
 *               something.
 */
function formatAffinity(
  key: FormatKey,
  touches: LessonTouch[],
  videos: VideoTouch[],
  grades: GradeTouch[],
  surfaceShare: Record<string, number>,
): number | null {
  let completion: number | null = null;
  let volume = 0;

  if (key === "video") {
    if (videos.length) {
      completion = videos.filter((v) => v.completed).length / videos.length;
      volume = videos.length;
    }
  } else {
    const mine = touches.filter((t) => normaliseType(t.type) === key);
    if (mine.length) {
      completion = mine.filter((t) => t.status === "completed").length / mine.length;
      volume = mine.length;
    }
  }

  // Voluntary surface pull, summed across every area that maps to this format.
  let pull = 0;
  for (const [area, share] of Object.entries(surfaceShare || {})) {
    if (surfaceToFormat(area) === key) pull += share;
  }

  // Score lift, only for graded formats and only against a real baseline.
  let scoreLift: number | null = null;
  const gradeTypeForFormat: Partial<Record<FormatKey, string[]>> = {
    quiz: ["quiz"],
    assignment: ["essay"],
    discussion: [],
    lesson: [],
    video: [],
  };
  const relevant = grades.filter((g) => (gradeTypeForFormat[key] ?? []).includes(g.type));
  const overall = mean(grades.map((g) => g.score));
  const forFormat = mean(relevant.map((g) => g.score));
  if (forFormat !== null && overall !== null && grades.length >= 4) {
    // ±25 points maps to ±0.5; clamped.
    scoreLift = clamp((forFormat - overall) / 50, -0.5, 0.5);
  }

  if (completion === null && pull <= 0 && scoreLift === null) return null;

  // Weight completion most, but let pull stand in for it entirely when nothing
  // of this format has been finished yet.
  const parts: Array<{ value: number; weight: number }> = [];
  if (completion !== null) parts.push({ value: completion, weight: volume >= 3 ? 0.6 : 0.45 });
  if (pull > 0) parts.push({ value: clamp(pull * 2.5, 0, 1), weight: completion === null ? 0.9 : 0.3 });
  if (scoreLift !== null) parts.push({ value: 0.5 + scoreLift, weight: 0.25 });

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight <= 0) return null;
  const blended = parts.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight;

  // Shrink toward neutral when the sample is small, so three finished quizzes
  // do not read as a 1.0 "loves quizzes" the way three of anything briefly
  // can. `pull` counts as evidence too — it is the whole of the reading when
  // nothing is finished yet — so a strong surface signal is not shrunk away.
  const n = volume + (pull > 0 ? 2 : 0);
  const K = 2;
  const shrunk = (blended * n + 0.5 * K) / (n + K);
  return round(clamp(shrunk, 0, 1), 3);
}

/** Fold unknown / legacy lesson types onto the five we weight. */
function normaliseType(type: string): FormatKey {
  const t = String(type || "").toLowerCase();
  if (t === "quiz") return "quiz";
  if (t === "assignment") return "assignment";
  if (t === "discussion" || t === "forum") return "discussion";
  if (t === "video") return "video";
  return "lesson";
}

/* -------------------------------------------------------------------------- */
/* The reading                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Turn one student's history into one student's taste.
 *
 * `now` is a parameter, not `new Date()`, so the tests can pin every
 * recency-sensitive number.
 */
export function readLearningStyle(inputs: StyleInputs, now: Date = new Date()): LearningStyle {
  const { lessonTouches, grades, videos, rhythm, seed, studentLevel } = inputs;

  const started = lessonTouches.length;
  const evidenceCount = started + videos.length + grades.length;
  const observedTier = tierFor(evidenceCount);

  const surfaceShare = rhythm?.surfaceShare ?? {};

  const formatAffinityMap = {} as Record<FormatKey, number | null>;
  for (const key of FORMAT_KEYS) {
    formatAffinityMap[key] = formatAffinity(key, lessonTouches, videos, grades, surfaceShare);
  }

  // Follow-through: completed lessons over started lessons. Videos count too —
  // a watched-to-the-end video is a finished thing.
  const finishable = started + videos.length;
  const finished =
    lessonTouches.filter((t) => t.status === "completed").length + videos.filter((v) => v.completed).length;
  const followThrough = finishable > 0 ? round(finished / finishable, 3) : null;

  // Sweet-spot length: the median nominal length of the lessons they actually
  // FINISHED, floored to their typical sitting. A student who once ground
  // through a 45-minute lesson but usually sits for 12 should be offered
  // 12-ish, not 45.
  const finishedLengths = lessonTouches
    .filter((t) => t.status === "completed" && typeof t.nominalMinutes === "number" && t.nominalMinutes! > 0)
    .map((t) => t.nominalMinutes as number);
  let sweetSpotMinutes = median(finishedLengths);
  if (sweetSpotMinutes !== null && rhythm && rhythm.avgSessionMinutes > 0) {
    sweetSpotMinutes = Math.min(sweetSpotMinutes, Math.max(6, rhythm.avgSessionMinutes));
  }
  if (sweetSpotMinutes === null && rhythm && rhythm.avgSessionMinutes > 0) {
    // No finished lengths yet, but we know how long they sit.
    sweetSpotMinutes = Math.max(6, rhythm.avgSessionMinutes);
  }
  sweetSpotMinutes = sweetSpotMinutes === null ? null : round(sweetSpotMinutes, 0);

  // Difficulty grit: completion rate on lessons pitched above their level.
  const myRank = levelRank(studentLevel);
  const stretch = lessonTouches.filter((t) => t.level && levelRank(t.level) > myRank);
  const difficultyGrit =
    stretch.length >= 2 ? round(stretch.filter((t) => t.status === "completed").length / stretch.length, 3) : null;

  const bestHours = rhythm?.bestHours?.slice(0, 3) ?? [];

  // -- Fold in the seed where behaviour has not spoken yet --------------------
  let confidence: ConfidenceTier = observedTier;
  const seedStyle = seed ? styleFromSeed(seed) : null;
  if (seedStyle) {
    for (const key of FORMAT_KEYS) {
      if (formatAffinityMap[key] === null) formatAffinityMap[key] = seedStyle.formatAffinity[key];
    }
    if (observedTier === "none") {
      confidence = "seed";
      if (sweetSpotMinutes === null) sweetSpotMinutes = seedStyle.sweetSpotMinutes;
    }
  }

  const anyAffinity = FORMAT_KEYS.some((key) => formatAffinityMap[key] !== null);
  if (confidence === "none" && !anyAffinity && sweetSpotMinutes === null) {
    return emptyStyle();
  }

  const style: LearningStyle = {
    confidence,
    evidenceCount,
    formatAffinity: formatAffinityMap,
    followThrough,
    sweetSpotMinutes,
    sessionShape: shapeFor(sweetSpotMinutes),
    bestHours,
    difficultyGrit,
    summary: "",
  };
  style.summary = describeStyle(style, rhythm);
  return style;
}

function emptyStyle(): LearningStyle {
  return {
    confidence: "none",
    evidenceCount: 0,
    formatAffinity: { lesson: null, quiz: null, assignment: null, discussion: null, video: null },
    followThrough: null,
    sweetSpotMinutes: null,
    sessionShape: null,
    bestHours: [],
    difficultyGrit: null,
    summary: "",
  };
}

/* -------------------------------------------------------------------------- */
/* The cold-start seed                                                         */
/* -------------------------------------------------------------------------- */

const SEED_FORMAT_AFFINITY: Record<string, Partial<Record<FormatKey, number>>> = {
  watch: { video: 0.75, lesson: 0.45, discussion: 0.5, quiz: 0.4, assignment: 0.35 },
  read: { lesson: 0.72, assignment: 0.6, quiz: 0.5, discussion: 0.45, video: 0.4 },
  practice: { quiz: 0.75, assignment: 0.62, lesson: 0.5, video: 0.42, discussion: 0.4 },
  mixed: { lesson: 0.55, quiz: 0.55, assignment: 0.52, discussion: 0.52, video: 0.55 },
};

const SEED_PACE_MINUTES: Record<string, number> = { short: 10, standard: 22, deep: 40 };

/**
 * A `LearningStyle` built purely from what the learner said at signup.
 * `confidence: "seed"` — the planner treats it as a gentle prior that real
 * behaviour is expected to overrule within a fortnight.
 */
export function styleFromSeed(seed: NonNullable<StyleSeed>): LearningStyle {
  const affinity = SEED_FORMAT_AFFINITY[String(seed.format || "").toLowerCase()] ?? {};
  const formatAffinity = {} as Record<FormatKey, number | null>;
  for (const key of FORMAT_KEYS) formatAffinity[key] = affinity[key] ?? null;

  const sweetSpotMinutes = SEED_PACE_MINUTES[String(seed.pace || "").toLowerCase()] ?? null;

  const style: LearningStyle = {
    confidence: "seed",
    evidenceCount: 0,
    formatAffinity,
    followThrough: null,
    sweetSpotMinutes,
    sessionShape: shapeFor(sweetSpotMinutes),
    bestHours: [],
    difficultyGrit: null,
    summary: "",
  };
  style.summary = describeStyle(style, null);
  return style;
}

/* -------------------------------------------------------------------------- */
/* Applying it to the plan                                                     */
/* -------------------------------------------------------------------------- */

/** How hard each tier is allowed to pull on the lesson queue. */
const TIER_GAIN: Record<ConfidenceTier, number> = {
  none: 0,
  seed: 0.4,
  thin: 0.5,
  fair: 0.85,
  strong: 1,
};

/**
 * The bounded nudge the planner adds to one lesson's score.
 *
 * Range is about -10..+12 before the tier gain, and the tier gain only ever
 * shrinks it. The academic scorer in ai.ts works on a scale where a good match
 * is worth ~20 and a bad difficulty fit costs ~8, so a full-strength style
 * nudge is roughly half a difficulty tier — enough to reorder near-ties and
 * lift a format the student loves, never enough to bury a lesson their weakest
 * skill needs.
 */
export function styleAdjustment(
  lesson: { type?: string | null; duration?: number | null; level?: string | null; courseLevel?: string | null },
  style: LearningStyle | null | undefined,
  studentLevelRank: number,
): number {
  if (!style || style.confidence === "none") return 0;
  const gain = TIER_GAIN[style.confidence];
  if (gain <= 0) return 0;

  let delta = 0;

  // -- Format match — the primary taste signal ----------------------------
  const format = normaliseType(String(lesson.type || "lesson"));
  const affinity = style.formatAffinity[format];
  if (affinity !== null && affinity !== undefined) {
    // 0.5 is neutral: love (1.0) → +7, avoid (0.0) → -7.
    delta += (affinity - 0.5) * 14;
  }

  // -- Length fit — secondary, so it can shade the format signal but not
  //    cancel it. A perfectly-sized lesson in an avoided format still nets
  //    negative.
  const len = typeof lesson.duration === "number" ? lesson.duration : null;
  if (len !== null && style.sweetSpotMinutes !== null) {
    const overshoot = len - style.sweetSpotMinutes;
    // Within ~6 min of the sweet spot is a small bonus; well past it is a
    // penalty that grows with the overshoot but is capped so one long lesson
    // is discouraged, not forbidden.
    delta += clamp(3 - Math.abs(overshoot) / 6, -6, 3);
  }

  // -- Grit on stretch content ------------------------------------------
  const lessonRank = levelRank(lesson.level || lesson.courseLevel);
  if (lessonRank > studentLevelRank && style.difficultyGrit !== null) {
    if (style.difficultyGrit < 0.4) delta -= 4;
    else if (style.difficultyGrit > 0.7) delta += 2;
  }

  return round(clamp(delta * gain, -12, 12), 2);
}

/* -------------------------------------------------------------------------- */
/* Exploration — the "keep it from going stale" pass                           */
/* -------------------------------------------------------------------------- */

export type ExploCandidate = {
  id: string;
  type?: string | null;
  duration?: number | null;
  level?: string | null;
  courseLevel?: string | null;
  _score?: number;
};

export type ExplorationPick<T extends ExploCandidate> = {
  picks: T[];
  /** Why these were surfaced, for the plan's `explorationReason`. */
  reason: string;
};

/**
 * A filter bubble is what you get when a recommender only ever serves what the
 * profile already likes: the plan calcifies, the student stops discovering
 * formats that might suit them better, and after a month it feels like the
 * portal has stopped paying attention. Every serious feed answers this the
 * same way — spend a small, fixed slice of slots on something deliberately
 * OFF-profile, then watch what happens to it.
 *
 * This picks that slice. It only runs once the profile is settled
 * (`fair`/`strong`) — exploring against a thin profile is just noise, because
 * nothing is "off" a profile we can barely read. Candidates are drawn from
 * just outside the top `keep`, so an exploratory pick is still a reasonable
 * lesson, only one the taste weighting pushed down.
 *
 * `rng` is injectable so a test can pin the choice. It is only used to break
 * ties among equally-off-profile candidates, never to invent a recommendation.
 */
export function pickExploration<T extends ExploCandidate>(
  ranked: T[],
  style: LearningStyle | null | undefined,
  options: { keep: number; ratio?: number } ,
  rng: () => number = Math.random,
): ExplorationPick<T> {
  const { keep } = options;
  const ratio = options.ratio ?? 0.15;
  if (!style || (style.confidence !== "fair" && style.confidence !== "strong")) {
    return { picks: [], reason: "" };
  }
  if (ranked.length <= keep) return { picks: [], reason: "" };

  const slots = Math.max(1, Math.round(keep * ratio));

  // The formats this student already leans on — anything else is "off profile".
  const preferred = new Set(
    FORMAT_KEYS.filter((key) => {
      const value = style.formatAffinity[key];
      return value !== null && value >= 0.55;
    }),
  );

  const offProfile = (candidate: T): number => {
    let score = 0;
    const format = normaliseType(String(candidate.type || "lesson"));
    if (preferred.size > 0 && !preferred.has(format)) score += 2;
    const len = typeof candidate.duration === "number" ? candidate.duration : null;
    if (len !== null && style.sweetSpotMinutes !== null && len > style.sweetSpotMinutes * 1.5) score += 1;
    return score;
  };

  // Draw from the band just past the kept set — still ranked lessons, just not
  // the ones taste floated to the top.
  const band = ranked.slice(keep, keep + Math.max(slots * 3, 6));
  const sorted = band
    .map((candidate) => ({ candidate, off: offProfile(candidate), jitter: rng() }))
    .filter((row) => row.off > 0)
    .sort((a, b) => b.off - a.off || b.jitter - a.jitter)
    .slice(0, slots)
    .map((row) => row.candidate);

  if (!sorted.length) return { picks: [], reason: "" };

  const formats = Array.from(new Set(sorted.map((c) => normaliseType(String(c.type || "lesson")))));
  return {
    picks: sorted,
    reason:
      `A ${formats.join(" and ")} ${sorted.length === 1 ? "lesson" : "lessons"} outside your usual pattern — ` +
      "in to see whether it lands. If you finish it, you will see more like it.",
  };
}

/* -------------------------------------------------------------------------- */
/* Saying it in English                                                        */
/* -------------------------------------------------------------------------- */

const FORMAT_NOUN: Record<FormatKey, string> = {
  lesson: "written lessons",
  quiz: "quizzes",
  assignment: "writing tasks",
  discussion: "discussions",
  video: "video lessons",
};

const SHAPE_PHRASE: Record<NonNullable<LearningStyle["sessionShape"]>, string> = {
  micro: "in very short bursts",
  short: "in short sittings",
  standard: "in a normal study block",
  deep: "in long, deep sessions",
};

export function hourLabel(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "midday";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/**
 * One line the student could be shown under their plan. It only claims what
 * the reading actually supports: no format sentence unless one format clearly
 * leads, no timing unless we know their hours.
 */
export function describeStyle(style: LearningStyle, rhythm: Rhythm): string {
  if (style.confidence === "none") return "";

  // A seed is what the student SAID, not what they did. Describing it as
  // "You get the most out of quizzes" would dress a guess up as a finding, so
  // a seed-only reading says out loud that it is provisional.
  if (style.confidence === "seed") {
    const pace = style.sessionShape ? ` You said you prefer to work ${SHAPE_PHRASE[style.sessionShape]}.` : "";
    return `Your plan starts from what you told us at sign-up${pace ? "." + pace : " — it will adjust as you study."}`;
  }

  const ranked = FORMAT_KEYS.map((key) => ({ key, value: style.formatAffinity[key] }))
    .filter((row): row is { key: FormatKey; value: number } => row.value !== null)
    .sort((a, b) => b.value - a.value);

  const parts: string[] = [];

  if (ranked.length && ranked[0].value >= 0.55 && (ranked.length === 1 || ranked[0].value - ranked[1].value >= 0.12)) {
    parts.push(`You get the most out of ${FORMAT_NOUN[ranked[0].key]}`);
  } else if (ranked.length >= 2 && ranked[0].value >= 0.5) {
    parts.push(`You mix ${FORMAT_NOUN[ranked[0].key]} and ${FORMAT_NOUN[ranked[1].key]}`);
  }

  if (style.sessionShape) {
    const lead = parts.length ? ", and you work best" : "You work best";
    parts.push(`${lead} ${SHAPE_PHRASE[style.sessionShape]}`);
  }

  if (rhythm && style.bestHours.length && (style.confidence === "fair" || style.confidence === "strong")) {
    parts.push(`${parts.length ? ", usually around " : "You are usually on around "}${hourLabel(style.bestHours[0])}`);
  }

  if (!parts.length) {
    return "Your plan is starting to adjust to how you actually study.";
  }

  let sentence = parts.join("");
  if (!/[.!?]$/.test(sentence)) sentence += ".";
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);

  if (style.confidence === "thin") {
    sentence += " Give it a couple of weeks and it will sharpen.";
  }
  return sentence;
}
