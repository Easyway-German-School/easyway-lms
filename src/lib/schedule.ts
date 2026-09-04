// Personalized class-schedule engine.
//
// A student's timetable is driven by two things from their profile:
//   1. their BATCH  (the FIRST of the level's teaching months, e.g. "August"
//                    means August + September — see lib/batch.ts)
//   2. their LEVEL  (A1, A2, B1, B2, C1, C2)
//
// ---------------------------------------------------------------------------
// THE WEEKDAY PATTERN BELONGS TO THE BATCH, NOT TO THE CALENDAR MONTH.
//
// This is the rule the school actually runs on and getting it wrong is the
// single most visible thing the calendar can do. Students are admitted in
// monthly batches; each batch is given a weekly timetable on day one and that
// timetable does not move for the whole two months of the course.
//
//   June batch      Mon / Fri / Sat   in June AND in July
//   July batch      Tue / Wed / Thu   in July AND in August
//   August batch    Mon / Fri / Sat   in August AND in September
//
// Consecutive BATCHES alternate, so the two cohorts running side by side never
// want the same rooms on the same days. Within one batch nothing changes.
//
// WHAT THIS REPLACED: the pattern was picked from the month's OFFSET inside the
// course — offset 0 got Mon/Fri/Sat and offset 1 got Tue/Wed/Thu — so every
// batch flipped its class days halfway through. A June student was shown
// Mon/Fri/Sat for June and then Tue/Wed/Thu for July, which is not a timetable
// this school has ever taught. The alternation is real; it just runs across
// batches, not across the months of one batch.
//
// The generator below is deterministic. When an AI model (Ollama / Claude) is
// wired in later it can enrich each session's `focus`, but the skeleton stays
// stable so the calendar is reliable by default.

export type ScheduleSession = {
  date: string; // ISO date string
  weekday: string; // "Mon"
  slot: string; // "Speaking Lab"
  focus: string; // short description of the session
  title: string; // "A1 · Speaking Lab"
  level: string;
};

export type ScheduleMonth = {
  label: string; // "August 2026"
  monthIndex: number; // 0-11
  year: number;
  offset: number; // months since batch start
  isBatchStart: boolean;
  patternDays: number[]; // JS weekday numbers (0=Sun)
  patternLabel: string; // "Mon · Fri · Sat"
  sessions: ScheduleSession[];
};

import { MONTH_NAMES, monthNameToIndex, resolveBatchAbsolute } from "@/lib/batch";

// Re-exported: `monthNameToIndex` used to live here, and several modules
// import it from this path.
export { monthNameToIndex };

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The two weekday patterns (JS getDay(): 0=Sun … 6=Sat).
const PATTERN_MFS = [1, 5, 6]; // Mon, Fri, Sat
const PATTERN_TWT = [2, 3, 4]; // Tue, Wed, Thu
// The weekend sitting meets once a week, not three times — there is no
// alternation to pick between, so this bypasses `patternForBatch` entirely.
const PATTERN_WEEKEND = [6]; // Sat only

/**
 * The pattern a batch teaches on, for every month of its course.
 *
 * Chosen from the batch's OWN starting month so that consecutive intakes
 * alternate — June Mon/Fri/Sat, July Tue/Wed/Thu, August Mon/Fri/Sat — and
 * then held constant, because the argument is the batch's, not the month's.
 *
 * Keyed on the month index rather than on the absolute month so the answer for
 * "the August batch" is the same in every year. (Those are in fact the same
 * parity — a year is twelve months, which is even — but saying it in terms of
 * the month index is saying what is meant.)
 *
 * Month indices are 0-based, so June is 5 and July is 6: an ODD index gets
 * Mon/Fri/Sat, which is what the school's June, August and October intakes run.
 */
function patternForBatch(batchMonthIndex: number): number[] {
  return batchMonthIndex % 2 === 1 ? PATTERN_MFS : PATTERN_TWT;
}

function patternLabel(days: number[]): string {
  return days.map((d) => WEEKDAY_SHORT[d]).join(" · ");
}

// Level-aware session focus so the timetable reads like a real curriculum
// rather than repeating the same label. Keyed by weekday + CEFR level band.
function sessionFor(level: string, weekday: string): { slot: string; focus: string } {
  const band = level.toUpperCase().charAt(0); // A, B or C
  const table: Record<string, { slot: string; focus: string }> = {
    Mon: {
      slot: "Speaking Lab",
      focus: band === "A" ? "Everyday conversation drills" : band === "B" ? "Debate & opinion practice" : "Academic discourse",
    },
    Tue: {
      slot: "Grammar Lab",
      focus: band === "A" ? "Core sentence structure" : band === "B" ? "Complex clauses & cases" : "Stylistic precision",
    },
    Wed: {
      slot: "Listening Lab",
      focus: band === "A" ? "Slow audio comprehension" : band === "B" ? "Native-speed audio" : "Lectures & interviews",
    },
    Thu: {
      slot: "Writing Lab",
      focus: band === "A" ? "Short guided writing" : band === "B" ? "Structured essays" : "Formal reports",
    },
    Fri: {
      slot: "Conversation Lab",
      focus: band === "A" ? "Role-play basics" : band === "B" ? "Situational fluency" : "Professional scenarios",
    },
    Sat: {
      slot: "Exam Workshop",
      focus: band === "A" ? "A-level exam prep" : band === "B" ? "B-level mock exam" : "C-level mastery mock",
    },
  };
  return table[weekday] ?? { slot: "Live Class", focus: "Guided practice" };
}

/**
 * The weekend sitting meets once a week, not five times, so it cannot follow
 * one weekday's slot every time without teaching nothing but "Exam Workshop"
 * for three months straight — that is what every weekday cohort's own Saturday
 * already is (see `sessionFor`'s "Sat" row), and it works there because it is
 * one sitting in five. Here it is the only one, so it cycles through the same
 * five labs a weekday cohort gets across its whole week, one per Saturday.
 */
function sessionForWeekend(level: string, weekIndex: number): { slot: string; focus: string } {
  const rotation: readonly string[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  return sessionFor(level, rotation[weekIndex % rotation.length]);
}

export type GenerateScheduleArgs = {
  level?: string | null;
  batch?: string | null; // month name e.g. "August" — the FIRST teaching month
  /**
   * When this student registered. Anchors WHICH occurrence of the batch month
   * is meant, so a student who signs up in August for the September batch is
   * placed in the September ahead of them rather than the one last year. See
   * lib/batch.ts.
   */
  registeredAt?: Date | null;
  /** Reference "now" — pass the request time so output is stable within a request. */
  now?: Date;
  /** How many months of timetable to generate. */
  months?: number;
  /** "weekend" meets Saturdays only and skips the Mon/Fri/Sat vs Tue/Wed/Thu alternation. */
  sessionSlot?: string | null;
};

export function generatePersonalizedSchedule({
  level,
  batch,
  registeredAt = null,
  now = new Date(),
  months = 2,
  sessionSlot = null,
}: GenerateScheduleArgs): { level: string; batchMonth: string; batchYear: number; months: ScheduleMonth[] } {
  const normalizedLevel = (typeof level === "string" && level.trim() ? level : "A1").toUpperCase();

  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const currentAbsolute = currentYear * 12 + currentMonth;

  // One shared rule for which calendar month a batch name points at. Falls
  // back to the current month when the batch is missing or unreadable.
  const batchAbsolute = resolveBatchAbsolute(batch, { registeredAt, now }) ?? currentAbsolute;
  const batchYear = Math.floor(batchAbsolute / 12);
  const batchMonthIndex = batchAbsolute % 12;

  // The timetable IS the batch window — August + September for an August
  // batch — so it starts at the batch month, full stop.
  //
  // This used to start at the CURRENT month once the batch was under way,
  // which quietly invented a third month of classes: an August student
  // looking in September was shown September and October, and October is
  // after their level has ended. The month they are standing in is found by
  // the calendar UI scrolling to it, not by cropping the course.
  const startOffset = 0;

  // Fixed for the whole course. Read once, outside the loop, so it is not even
  // possible for a later edit to make it depend on the month being generated.
  const isWeekend = String(sessionSlot ?? "").toLowerCase() === "weekend";
  const patternDays = isWeekend ? PATTERN_WEEKEND : patternForBatch(batchMonthIndex);

  const out: ScheduleMonth[] = [];
  // Counts Saturdays across the whole course (not reset per month), so a
  // weekend cohort's curriculum rotation carries on from where the previous
  // month left off instead of always starting the course back on "Mon".
  let weekendWeekIndex = 0;

  for (let i = 0; i < months; i += 1) {
    const offset = startOffset + i;
    const absoluteMonth = batchMonthIndex + offset;
    const monthIndex = ((absoluteMonth % 12) + 12) % 12;
    const year = batchYear + Math.floor(absoluteMonth / 12);

    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const sessions: ScheduleSession[] = [];

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, monthIndex, day);
      const jsWeekday = date.getDay();
      if (!patternDays.includes(jsWeekday)) continue;

      const weekday = WEEKDAY_SHORT[jsWeekday];
      const { slot, focus } = isWeekend
        ? sessionForWeekend(normalizedLevel, weekendWeekIndex++)
        : sessionFor(normalizedLevel, weekday);
      sessions.push({
        date: date.toISOString(),
        weekday,
        slot,
        focus,
        title: `${normalizedLevel} · ${slot}`,
        level: normalizedLevel,
      });
    }

    out.push({
      label: `${MONTH_NAMES[monthIndex]} ${year}`,
      monthIndex,
      year,
      offset,
      isBatchStart: offset === 0,
      patternDays,
      patternLabel: patternLabel(patternDays),
      sessions,
    });
  }

  return {
    level: normalizedLevel,
    batchMonth: MONTH_NAMES[batchMonthIndex],
    batchYear,
    months: out,
  };
}
