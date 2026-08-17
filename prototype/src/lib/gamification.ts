/**
 * The one place XP is scored.
 *
 * The dashboard already had this formula inline. The profile now shows the same
 * numbers, and two copies of a scoring rule drift — a student seeing "Level 4"
 * on one page and "Level 3" on another reads as a broken app, so the formula
 * moved here instead of being copied.
 */

export const XP_PER_LEVEL = 250;

/** Nobody starts on an empty bar; showing 0 XP on day one is discouraging. */
export const XP_FLOOR = 180;

export type XpInputs = {
  completedLessons?: number;
  /** Consecutive days with attendance or a submission. */
  streak?: number;
  examReadiness?: number;
  /** Percentage average across graded work, if any has been graded. */
  averageGrade?: number | null;
  /** Assignments actually handed in. */
  submissions?: number;
  /** Sessions marked present. */
  sessionsAttended?: number;
  /** Daily missions ticked off. */
  missionsCompleted?: number;
  /**
   * Finished live quiz games this student actually played in.
   *
   * Counted rather than scored on purpose. The game already ranks the room on
   * speed, and paying XP by score would rank it twice — the student who is
   * slowest in German gains least from the format and would then earn least
   * from it as well. Turning up and playing is the behaviour worth rewarding.
   */
  quizGamesPlayed?: number;
};

export type GamificationSummary = {
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  /** 0-100 across the current level only. */
  levelProgressPercent: number;
  tier: LearnerTier;
};

export type LearnerTier = {
  name: string;
  /** Level at which this tier starts. */
  from: number;
  /** Brand-aligned colour pair for badges and rings. */
  colors: [string, string];
  blurb: string;
};

/**
 * Tier names follow the German-learning journey the school actually sells,
 * rather than generic bronze/silver/gold.
 */
export const LEARNER_TIERS: LearnerTier[] = [
  { name: "Anfänger", from: 1, colors: ["#94a3b8", "#64748b"], blurb: "Just getting started" },
  { name: "Entdecker", from: 3, colors: ["#0D7C7E", "#12939a"], blurb: "Finding your rhythm" },
  { name: "Sprecher", from: 6, colors: ["#0ea5e9", "#0369a1"], blurb: "Holding conversations" },
  { name: "Kenner", from: 10, colors: ["#FF6600", "#d94f00"], blurb: "Serious momentum" },
  { name: "Meister", from: 16, colors: ["#f59e0b", "#b45309"], blurb: "Exam ready" },
];

export function tierForLevel(level: number): LearnerTier {
  // Walk backwards so the highest qualifying tier wins.
  return [...LEARNER_TIERS].reverse().find((tier) => level >= tier.from) ?? LEARNER_TIERS[0];
}

export function calculateXp(inputs: XpInputs): number {
  const gradeBonus = inputs.averageGrade ? Math.round((inputs.averageGrade - 70) / 2) : 0;

  const raw =
    (inputs.completedLessons ?? 0) * 45 +
    (inputs.streak ?? 0) * 25 +
    (inputs.examReadiness ?? 0) * 2 +
    (inputs.submissions ?? 0) * 30 +
    (inputs.sessionsAttended ?? 0) * 15 +
    (inputs.missionsCompleted ?? 0) * 20 +
    // Between a mission and a submission: more than ticking a box, less than
    // handing in written work, which is what a revision game is worth.
    (inputs.quizGamesPlayed ?? 0) * 25 +
    gradeBonus;

  return Math.max(XP_FLOOR, raw);
}

export function summarizeGamification(inputs: XpInputs): GamificationSummary {
  const xp = calculateXp(inputs);
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpIntoLevel = xp % XP_PER_LEVEL;

  return {
    xp,
    level,
    xpIntoLevel,
    xpForNextLevel: XP_PER_LEVEL,
    levelProgressPercent: Math.min(100, Math.round((xpIntoLevel / XP_PER_LEVEL) * 100)),
    tier: tierForLevel(level),
  };
}

/**
 * Which icon a badge wears. A name, not an emoji and not a component: this
 * module runs on the server and has no business importing JSX, so the portal
 * that renders a badge maps the name onto the real icon.
 */
export type BadgeIcon =
  | "door"
  | "calendar"
  | "flame"
  | "pencil"
  | "target"
  | "landmark"
  | "bolt"
  | "flag";

export type Badge = {
  id: string;
  name: string;
  description: string;
  icon: BadgeIcon;
  earned: boolean;
  /** 0-100 towards earning it, for the ones still locked. */
  progress: number;
};

/**
 * Badges are derived from records that actually exist — attendance rows, graded
 * work, submissions. Nothing here is awarded by a field someone has to remember
 * to set, so a badge can never be out of step with the student's real history.
 */
export function deriveBadges(stats: {
  sessionsAttended: number;
  submissions: number;
  averageGrade: number | null;
  streak: number;
  examsRegistered: number;
  level: string | null;
  missionsCompleted: number;
}): Badge[] {
  const pct = (value: number, target: number) =>
    Math.min(100, Math.round((value / target) * 100));

  return [
    {
      id: "first-steps",
      name: "Erste Schritte",
      description: "Attend your first class",
      icon: "door",
      earned: stats.sessionsAttended >= 1,
      progress: pct(stats.sessionsAttended, 1),
    },
    {
      id: "regular",
      name: "Stammgast",
      description: "Attend 10 classes",
      icon: "calendar",
      earned: stats.sessionsAttended >= 10,
      progress: pct(stats.sessionsAttended, 10),
    },
    {
      id: "streak-week",
      name: "Sieben Tage",
      description: "Keep a 7-day streak",
      icon: "flame",
      earned: stats.streak >= 7,
      progress: pct(stats.streak, 7),
    },
    {
      id: "hand-in",
      name: "Fleißig",
      description: "Hand in 5 assignments",
      icon: "pencil",
      earned: stats.submissions >= 5,
      progress: pct(stats.submissions, 5),
    },
    {
      id: "high-scorer",
      name: "Bestnote",
      description: "Average 80% or better",
      icon: "target",
      earned: (stats.averageGrade ?? 0) >= 80,
      progress: pct(stats.averageGrade ?? 0, 80),
    },
    {
      id: "exam-bound",
      name: "Prüfungsreif",
      description: "Register for an exam",
      icon: "landmark",
      earned: stats.examsRegistered >= 1,
      progress: pct(stats.examsRegistered, 1),
    },
    {
      id: "mission-runner",
      name: "Missionar",
      description: "Complete 10 daily missions",
      icon: "bolt",
      earned: stats.missionsCompleted >= 10,
      progress: pct(stats.missionsCompleted, 10),
    },
    {
      id: "b1-club",
      name: "B1 Club",
      description: "Reach level B1 or above",
      icon: "flag",
      earned: ["B1", "B2", "C1", "C2"].includes(String(stats.level ?? "").toUpperCase()),
      progress: ["B1", "B2", "C1", "C2"].includes(String(stats.level ?? "").toUpperCase()) ? 100 : 40,
    },
  ];
}

/**
 * Longest run of consecutive days ending today or yesterday.
 *
 * Ending "yesterday" still counts so the streak does not appear broken to
 * someone checking their profile in the morning before that day's class.
 */
export function calculateStreak(dates: Array<Date | string>): number {
  if (dates.length === 0) return 0;

  const days = new Set(
    dates.map((date) => {
      const value = new Date(date);
      return `${value.getUTCFullYear()}-${value.getUTCMonth()}-${value.getUTCDate()}`;
    }),
  );

  const dayKey = (offset: number) => {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() - offset);
    return `${value.getUTCFullYear()}-${value.getUTCMonth()}-${value.getUTCDate()}`;
  };

  // Anchor on today if present, else yesterday, else there is no live streak.
  let offset = days.has(dayKey(0)) ? 0 : days.has(dayKey(1)) ? 1 : -1;
  if (offset === -1) return 0;

  let streak = 0;
  while (days.has(dayKey(offset))) {
    streak += 1;
    offset += 1;
  }
  return streak;
}
