/**
 * The road to Germany.
 *
 * Every student who walks into EasyWay is not buying German lessons. They are
 * buying a life in Germany, and the lessons are the toll gates on the way. The
 * portal has until now shown them the toll gates — courses, XP, attendance —
 * and never once shown them the road. This file is the road.
 *
 * WHAT MAKES IT WORK, so that nobody later "tidies" the psychology out of it:
 *
 *  1. EVERY STAGE IS WRITTEN IN THE STUDENT'S OWN VOICE. Not "Registration
 *     complete" but "I registered." A progress bar describes a database row; a
 *     first-person sentence describes a person, and people defend sentences
 *     they have said about themselves. This is the single most important rule
 *     here and it is why `voice` comes before `label` in the type.
 *
 *  2. EVERY STAGE ADMITS YOU TO A SMALLER GROUP. Wishers → Registered →
 *     Committed → THE DOERS → Finishers → Arrived. The tribe name is the
 *     reward. The counts behind them are REAL (see germany-journey-server.ts)
 *     because a made-up "only 3% get this far" is the kind of lie that, once
 *     spotted, discredits the fee table on the same screen.
 *
 *  3. THE FUTURE IS SEALED, NOT BLANK. A locked stage carries one line of what
 *     is inside it. A padlock over nothing closes the loop; a padlock over a
 *     half-seen thing keeps it open. That is the whole Zeigarnik trick and it
 *     costs one string per stage.
 *
 *  4. NOTHING HERE INVENTS URGENCY. The countdown is the real 2 months. The
 *     arrival estimate is labelled a projection, not a promise. The school
 *     already decided, in the pay-in-full work, that it does not manufacture
 *     deadlines, and a student who catches this map lying stops believing the
 *     calendar too.
 *
 * NO PRISMA IMPORT. The map renders in the browser; the server file next door
 * does the database half.
 */

import { LEVELS, SESSION_MONTHS, nextLevelAfter } from "@/lib/levels";
import { CUSTOM_GOAL, goalFor, levelForGoal, type GermanyGoal } from "@/lib/germany-goals";

/* -------------------------------------------------------------------------- */
/* Stages                                                                     */
/* -------------------------------------------------------------------------- */

export type StageKind = "origin" | "commitment" | "level" | "destination";

/**
 * done     cleared, stamped, behind them
 * current  the one they are standing on
 * next     the very next one — visible, named, reachable
 * locked   sealed. Teaser only.
 */
export type StageStatus = "done" | "current" | "next" | "locked";

export type JourneyStage = {
  id: string;
  /** 1-based. The number in the corner of the card. */
  step: number;
  kind: StageKind;

  /** What the STUDENT says. First person, always. Rule 1 above. */
  voice: string;
  /** The two or three words under the node. */
  label: string;
  /** What the road says back once they clear it. Warm, never fake. */
  echo: string;
  /** One line visible while sealed. Rule 3 above. */
  teaser: string;
  /** The group they join by clearing it, or null where there is no new tribe. */
  tribe: string | null;

  status: StageStatus;
  /** Progress WITHIN this stage, 0–100. Only the current one is ever partial. */
  percent: number;
  /** ISO string, or null if not cleared. */
  clearedAt: string | null;

  /** Levels only. */
  level?: string;
  /**
   * True for the stages no database of ours can observe — documents, visa,
   * landing in Germany. The student tells us, and the office may confirm.
   */
  selfReported?: boolean;
  /** Free text the student added when they claimed a self-reported stage. */
  note?: string | null;
};

/* -------------------------------------------------------------------------- */
/* The fixed shape of the road                                                */
/* -------------------------------------------------------------------------- */

/**
 * The stages before the classroom.
 *
 * "I wish to learn German" is deliberately step one and deliberately already
 * complete for everybody who has an account. Endowed progress: a bar that
 * starts at zero is a bar you have not begun, and a bar that starts at 15% is a
 * thing you are already in the middle of. The wish is real — they made an
 * account — so this is a true statement, not a gift of fake progress.
 */
const APPROACH: Array<Omit<JourneyStage, "step" | "status" | "percent" | "clearedAt">> = [
  {
    id: "wish",
    kind: "origin",
    voice: "I want to learn German.",
    label: "The wish",
    echo: "Most people stop at wanting it. You did not.",
    teaser: "Where every road to Germany starts.",
    tribe: "The Wishers",
  },
  {
    id: "registered",
    kind: "commitment",
    voice: "I registered. I put my name down.",
    label: "Registered",
    echo: "You turned a wish into a record with your name on it.",
    teaser: "The day the wish gets a name, a branch and a batch.",
    tribe: "The Registered",
  },
  {
    id: "secured",
    kind: "commitment",
    voice: "I paid. My seat is mine.",
    label: "Seat secured",
    echo: "You backed yourself with your own money. That changes things.",
    teaser: "The seat with your name on it, held.",
    tribe: "The Committed",
  },
  {
    id: "firstDay",
    kind: "commitment",
    // This is THE line of the whole map. Everything before it can be done from
    // a phone in bed. This one cannot.
    voice: "I showed up. I sat in the class.",
    label: "First day",
    echo: "This is the step most people never take. You are one of the Doers now.",
    teaser: "The morning you actually walk in. Nothing online can fake this one.",
    tribe: "The Doers",
  },
];

/** What a level means in the student's own words, and what it buys them. */
const LEVEL_VOICE: Record<string, { voice: string; echo: string; teaser: string; unlocks: string }> = {
  A1: {
    voice: "I finished A1. I can hold my first real conversation.",
    echo: "Two months ago this alphabet was noise. Now you can introduce yourself to a German.",
    teaser: "Greetings, numbers, your own story — the first hundred words that stop feeling foreign.",
    unlocks: "You can introduce yourself, ask for things, and survive a shop.",
  },
  A2: {
    voice: "I finished A2. I can handle everyday life in German.",
    echo: "You can now get through a day in Germany without English. That is not nothing.",
    teaser: "Past tense, opinions, appointments — the German of an ordinary Tuesday.",
    unlocks: "You can book, complain, explain and follow a normal conversation.",
  },
  B1: {
    voice: "I finished B1. This is the level the embassy asks for.",
    echo: "B1 is the line most Ausbildung and visa applications are drawn at. You are over it.",
    teaser: "The level named on most Ausbildung contracts and visa checklists.",
    unlocks: "The level most Ausbildung placements and visa files require.",
  },
  B2: {
    voice: "I finished B2. I can work in German.",
    echo: "You can now sit in a German workplace and be understood as a colleague, not a guest.",
    teaser: "The level that turns a language into a livelihood.",
    unlocks: "Employers and universities stop treating your German as a risk.",
  },
  C1: {
    voice: "I finished C1. I can study in German.",
    echo: "German universities take C1 seriously. So should you — this is rare air.",
    teaser: "Lectures, contracts, arguments. German as a working tool.",
    unlocks: "University admission and professional registration open up.",
  },
  C2: {
    voice: "I finished C2. There is no higher level.",
    echo: "There is nothing above this. You have finished the ladder.",
    teaser: "The top of the ladder. Very few people stand here.",
    unlocks: "Everything. There is no level above this one.",
  },
};

/**
 * After the classroom.
 *
 * THESE COME FROM THE STUDENT'S GOAL, not from a fixed list — see
 * `lib/germany-goals.ts`. A nurse's road ends with Anerkennung and a first
 * shift; a student's ends with a blocked account and a first lecture. Showing
 * both of them the same four grey boxes marked "documents / visa / arrival" is
 * how the old map managed to be about Germany without being about anybody.
 *
 * They are all self-reported: we do not run the embassy. The student claims
 * them and the office may confirm them, exactly as happens in the branch
 * already. Leaving them off because we cannot verify them would end the road at
 * a certificate, and the road does not end at a certificate.
 */
function destinationStagesFor(goal: GermanyGoal): Array<Omit<JourneyStage, "step" | "status" | "percent" | "clearedAt">> {
  return goal.stages.map((stage) => ({
    id: stage.id,
    kind: "destination" as const,
    voice: stage.voice,
    label: stage.label,
    echo: stage.echo,
    teaser: stage.teaser,
    tribe: stage.tribe,
    selfReported: stage.selfReported,
  }));
}

/* -------------------------------------------------------------------------- */
/* Target level                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How far up the ladder this student is actually going.
 *
 * Drawing all six levels for a student whose Ausbildung needs B1 makes their
 * road look twice as long as it is, and a road that looks twice as long is one
 * people put off starting. Read the goal off whatever the office recorded and
 * fall back to B2, which is where most EasyWay students are heading.
 */
export function targetLevelFor(input: {
  outcome?: string | null;
  pathway?: string | null;
  admissionTarget?: string | null;
  currentLevel?: string | null;
  /** The goal they picked themselves. Beats everything the office guessed. */
  goalId?: string | null;
}): string {
  /** Highest level named in a string: "B1 then B2" means B2. */
  const highestIn = (text: string | null | undefined): string | null => {
    const haystack = String(text ?? "").toUpperCase();
    let found: string | null = null;
    for (const level of LEVELS) {
      if (haystack.includes(level)) found = level;
    }
    return found;
  };

  // A goal the student actually stated beats one inferred from the pathway
  // blurb. `outcome` defaults to "C1 readiness + German work placement
  // support" on every account ever created, so reading the two together made
  // every student's target C1 and drew them a road half again as long as the
  // one they signed up for.
  const found = highestIn(input.admissionTarget) ?? highestIn(`${input.outcome ?? ""} ${input.pathway ?? ""}`);

  const current = String(input.currentLevel ?? "A1").toUpperCase();
  const currentIndex = (LEVELS as readonly string[]).indexOf(current);
  const foundIndex = found ? (LEVELS as readonly string[]).indexOf(found) : -1;

  // A goal below where they already are is a stale goal, not a goal.
  const fromFile =
    foundIndex >= 0 && foundIndex >= currentIndex
      ? LEVELS[foundIndex]
      : LEVELS[Math.max(currentIndex, (LEVELS as readonly string[]).indexOf("B2"))] ?? "B2";

  // The goal they chose can only ever LENGTHEN the road, never shorten it —
  // see levelForGoal. Someone who tells us they are joining a spouse (A1) does
  // not get their B2 course quietly cut in half; someone heading to university
  // gets told about the C1 before they finish B2 and find out the hard way.
  if (!input.goalId) return fromFile;
  return levelForGoal(goalFor(input.goalId), fromFile);
}

/* -------------------------------------------------------------------------- */
/* The countdown                                                              */
/* -------------------------------------------------------------------------- */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CountdownPhase = "settling-in" | "climbing" | "home-straight" | "final-week" | "overdue";

export type LevelCountdown = {
  level: string;
  /** The day they told us they walked in. The clock runs from HERE. */
  startedOn: string;
  /** SESSION_MONTHS later. */
  endsOn: string;

  totalDays: number;
  daysElapsed: number;
  daysLeft: number;

  weeksElapsed: number;
  weeksTotal: number;
  /** 1-based: "week 3 of 8". */
  weekNumber: number;

  monthsElapsed: number;
  monthsTotal: number;
  monthNumber: number;

  percent: number;
  phase: CountdownPhase;
  /** The one line the student reads at the top of the countdown. */
  headline: string;
  /** The smaller line under it. */
  subline: string;
};

/** Midnight, local. Countdowns are counted in days, and days start at midnight. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function buildCountdown(
  level: string,
  startedAt: Date | string,
  { now = new Date(), months = SESSION_MONTHS }: { now?: Date; months?: number } = {},
): LevelCountdown {
  const started = startOfDay(new Date(startedAt));
  const today = startOfDay(now);

  // Calendar months, not 60 days. A student who starts on 3 August finishes at
  // the start of October, and telling them "60 days" when the office says "two
  // months" makes the portal and the counter disagree in front of them.
  const ends = new Date(started.getFullYear(), started.getMonth() + months, started.getDate());

  const totalDays = Math.max(1, Math.round((ends.getTime() - started.getTime()) / MS_PER_DAY));
  const rawElapsed = Math.round((today.getTime() - started.getTime()) / MS_PER_DAY);
  const daysElapsed = Math.max(0, rawElapsed);
  const daysLeft = Math.max(0, totalDays - daysElapsed);

  const weeksTotal = Math.max(1, Math.round(totalDays / 7));
  const weeksElapsed = Math.floor(daysElapsed / 7);
  const weekNumber = Math.min(weeksTotal, weeksElapsed + 1);

  const monthsElapsed = Math.floor(daysElapsed / (totalDays / months));
  const monthNumber = Math.min(months, monthsElapsed + 1);

  const percent = Math.max(0, Math.min(100, Math.round((daysElapsed / totalDays) * 100)));

  const phase: CountdownPhase =
    daysElapsed > totalDays
      ? "overdue"
      : daysLeft <= 7
        ? "final-week"
        : percent >= 60
          ? "home-straight"
          : percent >= 20
            ? "climbing"
            : "settling-in";

  // The framing FLIPS at the halfway mark, on purpose. Early on, "day 6" is the
  // encouraging number and "54 days left" is a wall. Late on, "12 days left" is
  // the number that gets somebody to class and "day 48" says nothing. Same
  // clock, read from whichever end is currently motivating — which is the
  // goal-gradient effect, and it is free.
  const headline =
    phase === "overdue"
      ? `${level} has run its full ${months} months`
      : percent < 50
        ? `Day ${daysElapsed + 1} of your ${level}`
        : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} of ${level} left`;

  const subline =
    phase === "overdue"
      ? "Your branch will confirm your result and open the next level."
      : phase === "final-week"
        ? `Final week. Week ${weekNumber} of ${weeksTotal}.`
        : percent < 50
          ? `Week ${weekNumber} of ${weeksTotal} · month ${monthNumber} of ${months}`
          : `Week ${weekNumber} of ${weeksTotal} · ${percent}% of the way through`;

  return {
    level,
    startedOn: started.toISOString(),
    endsOn: ends.toISOString(),
    totalDays,
    daysElapsed,
    daysLeft,
    weeksElapsed,
    weeksTotal,
    weekNumber,
    monthsElapsed,
    monthsTotal: months,
    monthNumber,
    percent,
    phase,
    headline,
    subline,
  };
}

/* -------------------------------------------------------------------------- */
/* The arrival projection                                                     */
/* -------------------------------------------------------------------------- */

export type ArrivalEstimate = {
  /** ISO. Null when there is nothing honest to project from. */
  date: string | null;
  /** "March 2028" */
  label: string | null;
  /** Levels still to teach between here and the target. */
  levelsRemaining: number;
  /** Months of teaching left, before paperwork. */
  monthsOfTeaching: number;
  /** The words that must appear next to the date. Not optional. */
  caveat: string;
};

/**
 * When they could realistically be standing in Germany.
 *
 * This is the single most motivating number on the whole screen, because it
 * converts an abstract ladder into a date they can picture themselves on. It
 * is also the easiest thing here to turn into a lie, so:
 *
 *   - it counts only what the school controls (teaching months) plus a flat,
 *     stated allowance for paperwork;
 *   - it assumes levels run back to back, and SAYS SO;
 *   - it is labelled an estimate everywhere it is rendered. The `caveat` is
 *     part of the return value rather than a prop the UI may forget to pass.
 */
export function estimateArrival(input: {
  currentLevel: string;
  targetLevel: string;
  /** Where the current level is up to. */
  countdown?: LevelCountdown | null;
  /** Months to allow for exam, documents and the visa appointment. */
  paperworkMonths?: number;
  now?: Date;
}): ArrivalEstimate {
  const { paperworkMonths = 4, now = new Date() } = input;
  const levels = LEVELS as readonly string[];
  const from = levels.indexOf(String(input.currentLevel ?? "A1").toUpperCase());
  const to = levels.indexOf(String(input.targetLevel ?? "B2").toUpperCase());

  if (from < 0 || to < 0 || to < from) {
    return {
      date: null,
      label: null,
      levelsRemaining: 0,
      monthsOfTeaching: 0,
      caveat: "An estimate, not a promise.",
    };
  }

  // The level they are sitting counts as a whole one unless a countdown tells
  // us how far through it they are.
  const levelsAfterCurrent = to - from;
  const currentLevelMonthsLeft = input.countdown
    ? Math.max(0, SESSION_MONTHS * (1 - input.countdown.percent / 100))
    : SESSION_MONTHS;

  const monthsOfTeaching = currentLevelMonthsLeft + levelsAfterCurrent * SESSION_MONTHS;
  const totalMonths = Math.ceil(monthsOfTeaching + paperworkMonths);

  const date = new Date(now.getFullYear(), now.getMonth() + totalMonths, 1);

  return {
    date: date.toISOString(),
    label: date.toLocaleString("en-US", { month: "long", year: "numeric" }),
    levelsRemaining: levelsAfterCurrent + 1,
    monthsOfTeaching: Math.round(monthsOfTeaching),
    caveat: `If your levels run back to back and paperwork takes the usual ${paperworkMonths} months. An estimate, not a promise.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Building the map                                                           */
/* -------------------------------------------------------------------------- */

export type JourneyInput = {
  studentName: string;
  branchName: string | null;
  currentLevel: string;
  targetLevel: string;

  registeredAt: Date | string | null;
  /** Registration fee settled. */
  registrationPaid: boolean;
  /** Enough paid to hold the seat. */
  seatSecured: boolean;
  /** The day they said they walked in. Null until confirmed. */
  classesStartedAt: Date | string | null;

  /** Levels the office has marked finished, e.g. ["A1"]. */
  levelsCompleted: string[];
  /** Self-reported stages: { visa: { at, note } }. */
  claimedStages: Record<string, { at?: string | null; note?: string | null }>;

  /** Which of the eight roads they said they are on. Null until they answer. */
  goalId?: string | null;
  /** Their own words, when they picked "Something else". */
  goalNote?: string | null;

  now?: Date;
};

export type Journey = {
  studentName: string;
  firstName: string;
  branchName: string | null;
  currentLevel: string;
  targetLevel: string;

  stages: JourneyStage[];
  /** Index into `stages` of the one they are standing on. */
  currentIndex: number;
  /** The headline number: how far along the whole road. */
  percentToGermany: number;

  countdown: LevelCountdown | null;
  arrival: ArrivalEstimate;

  /** The road they are on, resolved. Always present — see goalFor. */
  goal: GermanyGoal;
  /** Their own words, if they gave any. */
  goalNote: string | null;
  /**
   * True when nobody has asked them yet. The map still draws — the generic
   * road is a real road — but the portal owes them the question.
   */
  goalUnset: boolean;

  /** True before they have confirmed their first day. */
  awaitingStart: boolean;
  /** True before any money has been taken — the map is a preview only. */
  previewOnly: boolean;

  /** The tribe they are currently in, and the one immediately above. */
  tribe: string | null;
  nextTribe: string | null;

  /** The sentence at the very top of the map. */
  headline: string;
  /** The one under it. */
  subheadline: string;
};

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildJourney(input: JourneyInput): Journey {
  const now = input.now ?? new Date();
  const goal = input.goalId ? goalFor(input.goalId) : CUSTOM_GOAL;
  const goalUnset = !input.goalId;
  const currentLevel = String(input.currentLevel ?? "A1").toUpperCase();
  const targetLevel = String(input.targetLevel ?? "B2").toUpperCase();
  const levels = LEVELS as readonly string[];

  const completed = new Set(input.levelsCompleted.map((l) => String(l).toUpperCase()));
  const startedIso = toIso(input.classesStartedAt);

  // Which level nodes to draw. Never fewer than the one they are sitting in,
  // never more than their goal — see targetLevelFor.
  const fromIndex = 0;
  const toIndex = Math.max(levels.indexOf(currentLevel), levels.indexOf(targetLevel));
  const levelNodes = levels.slice(fromIndex, toIndex + 1);

  const raw: Array<Omit<JourneyStage, "step" | "status" | "percent">> = [];

  // ---- Approach ---------------------------------------------------------
  raw.push({ ...APPROACH[0], clearedAt: toIso(input.registeredAt) ?? now.toISOString() });
  raw.push({ ...APPROACH[1], clearedAt: input.registrationPaid ? toIso(input.registeredAt) : null });
  raw.push({ ...APPROACH[2], clearedAt: input.seatSecured ? toIso(input.registeredAt) : null });
  raw.push({ ...APPROACH[3], clearedAt: startedIso });

  // ---- The ladder -------------------------------------------------------
  for (const level of levelNodes) {
    const copy = LEVEL_VOICE[level];
    raw.push({
      id: `level:${level}`,
      kind: "level",
      level,
      voice: copy.voice,
      label: level,
      echo: copy.echo,
      teaser: copy.teaser,
      tribe: level === targetLevel ? "The Finishers" : null,
      clearedAt: completed.has(level) ? (input.claimedStages[`level:${level}`]?.at ?? null) : null,
    });
  }

  // ---- Destination ------------------------------------------------------
  for (const stage of destinationStagesFor(goal)) {
    const claim = input.claimedStages[stage.id];
    raw.push({
      ...stage,
      clearedAt: claim?.at ?? null,
      note: claim?.note ?? null,
    });
  }

  // A stage is "done" when it has a cleared date. The FIRST one without a date
  // is where they are standing; everything after it is sealed. Deriving the
  // cursor from the data rather than storing it means the map cannot drift out
  // of step with the payments and the register.
  let currentIndex = raw.findIndex((stage) => !stage.clearedAt);
  if (currentIndex === -1) currentIndex = raw.length - 1;

  const countdown =
    startedIso && !completed.has(currentLevel)
      ? buildCountdown(currentLevel, startedIso, { now })
      : null;

  const stages: JourneyStage[] = raw.map((stage, index) => {
    const status: StageStatus =
      stage.clearedAt ? "done" : index === currentIndex ? "current" : index === currentIndex + 1 ? "next" : "locked";

    // Only the stage they are standing on is ever partial. A locked stage
    // showing 0% and a done stage showing 100% is noise; the one live number
    // is the one that means something.
    let percent = status === "done" ? 100 : 0;
    if (status === "current") {
      if (stage.level && countdown && stage.level === currentLevel) percent = countdown.percent;
      else if (stage.id === "firstDay") percent = 0;
    }

    return { ...stage, step: index + 1, status, percent };
  });

  // The headline percentage counts PART-DONE stages, so the bar moves during a
  // level instead of jumping every two months. A bar that sits still for eight
  // weeks is a bar people stop looking at.
  const earned = stages.reduce((sum, stage) => sum + stage.percent / 100, 0);
  const percentToGermany = Math.max(0, Math.min(100, Math.round((earned / stages.length) * 100)));

  const tribe = [...stages].reverse().find((s) => s.status === "done" && s.tribe)?.tribe ?? null;
  const nextTribe = stages.find((s) => s.status !== "done" && s.tribe)?.tribe ?? null;

  const awaitingStart = !startedIso;
  const previewOnly = !input.seatSecured;
  const firstName = (input.studentName || "").trim().split(/\s+/)[0] || "there";

  const headline = previewOnly
    ? `${firstName}, this is your road to Germany`
    : awaitingStart
      ? `${firstName}, your road is ready. One step to start the clock.`
      : `You are ${percentToGermany}% of the way to ${goalUnset ? "Germany" : goal.destination}`;

  // Once they have told us WHY, the second line is their own reason read back
  // to them rather than a status. A countdown says what the school is doing; a
  // dream says what they are doing, and only one of those gets somebody out of
  // bed for a 7am class.
  const subheadline = previewOnly
    ? "Everything below is yours the moment your seat is paid for."
    : awaitingStart
      ? "Your two months begin the day you walk into class — not the day you paid."
      : goalUnset
        ? countdown?.headline ?? "Your branch will open the next stage when this one is signed off."
        : goal.dream;

  return {
    studentName: input.studentName,
    firstName,
    branchName: input.branchName,
    currentLevel,
    targetLevel,
    stages,
    currentIndex,
    percentToGermany,
    countdown,
    // The paperwork allowance is the goal's, not a flat four months. A family
    // visa and a nursing recognition are not the same wait, and quoting the
    // same arrival month to both is the kind of small lie that gets found out.
    arrival: estimateArrival({
      currentLevel,
      targetLevel,
      countdown,
      paperworkMonths: goal.paperworkMonths,
      now,
    }),
    goal,
    goalNote: input.goalNote?.trim() || null,
    goalUnset,
    awaitingStart,
    previewOnly,
    tribe,
    nextTribe,
    headline,
    subheadline,
  };
}

/* -------------------------------------------------------------------------- */
/* The daily "have you started?" question                                     */
/* -------------------------------------------------------------------------- */

/**
 * Why they might not have started yet.
 *
 * These are offered as buttons rather than a text box because a text box gets
 * skipped and a button gets pressed — and the answer is the most valuable
 * churn signal the school has. A student on their fifth "I am still sorting
 * the money" is a student the branch can still save with one phone call; a
 * student who quietly never came back is one nobody knew about.
 *
 * `escalate` marks the reasons the office should act on rather than just count.
 */
export const NOT_STARTED_REASONS = [
  {
    id: "not-begun",
    label: "My batch has not started yet",
    detail: "Classes at my branch have not begun.",
    escalate: false,
    reply: "That is fine — nothing is late. We will ask again tomorrow.",
  },
  {
    id: "travelling",
    label: "I am travelling or away",
    detail: "I am not in town yet.",
    escalate: false,
    reply: "Safe travels. Your seat is not going anywhere.",
  },
  {
    id: "money",
    label: "I am still sorting my fees",
    detail: "Payment is not settled.",
    escalate: true,
    reply: "Understood. Your branch can talk options with you — that conversation is free.",
  },
  {
    id: "schedule",
    label: "The class time does not work for me",
    detail: "Wrong sitting — morning, afternoon or evening.",
    escalate: true,
    reply: "That is fixable. Your branch can move you to another sitting.",
  },
  {
    id: "other",
    label: "Something else",
    detail: "Another reason.",
    escalate: true,
    reply: "Noted. Someone from your branch will check in with you.",
  },
] as const;

export type NotStartedReasonId = (typeof NOT_STARTED_REASONS)[number]["id"];

/** How many "not yet"s before this becomes a phone call rather than a counter. */
export const NOT_STARTED_ESCALATION_THRESHOLD = 4;

export type StartPrompt = {
  /** Show it? */
  due: boolean;
  /** How many times they have said "not yet". */
  askedBefore: number;
  /** ISO — when the snooze runs out. */
  snoozedUntil: string | null;
  /** The question, which softens the more times it has been asked. */
  question: string;
  /** The line under the question. */
  reassurance: string;
};

/**
 * Whether to ask today, and how to ask it.
 *
 * TWO DAYS OF GRACE, on purpose. Asking "have you started yet?" the morning
 * after somebody pays is asking a question whose answer we already know, and
 * it teaches them to dismiss this dialog before reading it — which is exactly
 * the habit we cannot afford by the time it matters.
 */
export function buildStartPrompt(input: {
  seatSecured: boolean;
  classesStartedAt: Date | string | null;
  registeredAt: Date | string | null;
  snoozedUntil: Date | string | null;
  notStartedCount: number;
  /** Days after registration before the first ask. */
  graceDays?: number;
  now?: Date;
}): StartPrompt {
  const { graceDays = 2, now = new Date() } = input;
  const asked = Math.max(0, input.notStartedCount || 0);

  const question =
    asked === 0
      ? "Have you started classes yet?"
      : asked < 3
        ? "Any luck — have you made it into class?"
        : "Still not started? Tell us why and we will help.";

  const reassurance =
    asked === 0
      ? "Your two months start the day you walk in, so this is the button that starts your clock."
      : asked < 3
        ? "No pressure. We ask once a day and nothing counts against you."
        : "You have told us a few times now. Your branch would rather fix this than lose you.";

  const base: StartPrompt = {
    due: false,
    askedBefore: asked,
    snoozedUntil: toIso(input.snoozedUntil),
    question,
    reassurance,
  };

  // Nothing to ask a student who has not paid for a seat, or who has already
  // answered.
  if (!input.seatSecured) return base;
  if (input.classesStartedAt) return base;

  if (input.registeredAt) {
    const registered = startOfDay(new Date(input.registeredAt));
    const daysSince = Math.floor((startOfDay(now).getTime() - registered.getTime()) / MS_PER_DAY);
    if (daysSince < graceDays) return base;
  }

  if (input.snoozedUntil && new Date(input.snoozedUntil) > now) return base;

  return { ...base, due: true };
}

/** "Not yet" pushes the question to tomorrow morning, never kills it. */
export function nextAskAfter(now = new Date()): Date {
  const tomorrow = startOfDay(new Date(now.getTime() + MS_PER_DAY));
  return tomorrow;
}

/* -------------------------------------------------------------------------- */
/* The once-a-day moment                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Should the map open by itself today?
 *
 * Per ACCOUNT, not per device — a student who saw it on a laptop at 9am should
 * not meet it again on their phone at noon. That is why the stamp lives on
 * Student.journeySeenAt and not in localStorage, unlike the first version of
 * the level poster.
 */
export function journeyMomentDue(seenAt: Date | string | null, now = new Date()): boolean {
  if (!seenAt) return true;
  const seen = new Date(seenAt);
  if (Number.isNaN(seen.getTime())) return true;
  return startOfDay(seen).getTime() < startOfDay(now).getTime();
}

export { SESSION_MONTHS, nextLevelAfter };
