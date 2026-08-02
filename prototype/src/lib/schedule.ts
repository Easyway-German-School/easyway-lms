// Personalized class-schedule engine.
//
// A student's timetable is driven by two things from their profile:
//   1. their BATCH  (the FIRST of the level's teaching months, e.g. "August"
//                    means August + September — see lib/batch.ts)
//   2. their LEVEL  (A1, A2, B1, B2, C1, C2)
//
// The weekday pattern ROTATES month-by-month from the batch start month:
//   - batch month + even offset (0, 2, 4 …): Monday / Friday / Saturday
//   - batch month + odd  offset (1, 3, 5 …): Tuesday / Wednesday / Thursday
// so e.g. an August batch runs Mon/Fri/Sat in August, Tue/Wed/Thu in September,
// Mon/Fri/Sat in October, and so on — repeating smartly across months.
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

// Rotating weekday patterns (JS getDay(): 0=Sun … 6=Sat).
const PATTERN_EVEN = [1, 5, 6]; // Mon, Fri, Sat
const PATTERN_ODD = [2, 3, 4]; // Tue, Wed, Thu

function patternForOffset(offset: number): number[] {
  return offset % 2 === 0 ? PATTERN_EVEN : PATTERN_ODD;
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
};

export function generatePersonalizedSchedule({
  level,
  batch,
  registeredAt = null,
  now = new Date(),
  months = 2,
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

  const out: ScheduleMonth[] = [];

  for (let i = 0; i < months; i += 1) {
    const offset = startOffset + i;
    const absoluteMonth = batchMonthIndex + offset;
    const monthIndex = ((absoluteMonth % 12) + 12) % 12;
    const year = batchYear + Math.floor(absoluteMonth / 12);
    const patternDays = patternForOffset(offset);

    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const sessions: ScheduleSession[] = [];

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, monthIndex, day);
      const jsWeekday = date.getDay();
      if (!patternDays.includes(jsWeekday)) continue;

      const weekday = WEEKDAY_SHORT[jsWeekday];
      const { slot, focus } = sessionFor(normalizedLevel, weekday);
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
