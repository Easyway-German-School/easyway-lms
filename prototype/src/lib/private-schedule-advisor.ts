import {
  SCHEDULE_DAYS,
  type NormalizedSchedulePreferences,
  type ScheduleDay,
} from "@/lib/private-schedule-preferences";
import { WEEKDAY_NAMES, hourLabel, type BehaviourProfile } from "@/lib/learner-signals";

/**
 * WHICH HOUR SHOULD THIS ONE-TO-ONE CLASS ACTUALLY BE AT.
 *
 * Becca has been asking private students when they are free since the feature
 * shipped, and doing nothing with the answer but forwarding it to a tutor.
 * That is a form, not an assistant — and it inherits the oldest problem in
 * scheduling: WHAT PEOPLE SAY THEY ARE FREE FOR IS NOT WHEN THEY TURN UP.
 * Students tick Saturday morning because it sounds virtuous, then miss it
 * three weeks running while opening the app at 10pm every single night.
 *
 * This file exists to hold both facts at once. It scores candidate slots on
 * two independent sources of evidence:
 *
 *   STATED   the day/time ranges the student marked, and their preferred start
 *            times. Authoritative about constraints — if they are at work
 *            until six, no amount of behavioural data overrules that.
 *   OBSERVED the hours they are actually in the portal, from their behaviour
 *            profile. Authoritative about energy — this is when they are awake,
 *            free enough to study, and likely to show up.
 *
 * A slot that satisfies both is the strongest recommendation this system can
 * make. Where the two DISAGREE, that disagreement is the most useful output
 * of the whole feature, and it is returned rather than averaged away: telling
 * a student "you asked for mornings, but you are almost never here before
 * midday" is a better conversation than silently booking one or the other.
 *
 * DETERMINISTIC ON PURPOSE. Every number below is computed here, in code that
 * can be read and tested. The language model's job is downstream and strictly
 * limited to WORDING — see the route. A scheduler whose slots come out of a
 * model is a scheduler nobody can debug, and it will eventually double-book a
 * tutor with great enthusiasm.
 */

export type Candidate = {
  day: ScheduleDay;
  /** 24h start, "HH:MM". */
  start: string;
  hour: number;
  /** 0-100. What the two kinds of evidence add up to. */
  score: number;
  /** Which evidence is behind it, for the explanation. */
  reasons: string[];
  matchesStated: boolean;
  matchesObserved: boolean;
  /** True when the tutor already has something within the hour. */
  tutorBusy: boolean;
};

export type Advice = {
  candidates: Candidate[];
  /**
   * Set when the stated availability and the observed rhythm point at
   * different times of day. The single most valuable thing here.
   */
  mismatch: { statedHours: number[]; observedHours: number[]; note: string } | null;
  /** What we could and could not use. Never hidden — see below. */
  evidence: {
    hasStated: boolean;
    hasObserved: boolean;
    observedEvents: number;
    /** Behaviour is only trusted once there is enough of it to mean anything. */
    observedTrusted: boolean;
  };
  /** Plain-English fallback, used verbatim when no model is available. */
  fallbackMessage: string;
};

/** Below this many recorded movements, a rhythm is a coincidence. */
const MIN_EVENTS_FOR_RHYTHM = 25;

/** Classes are not scheduled outside these hours whatever the data says. */
const EARLIEST_HOUR = 6;
const LATEST_HOUR = 21;

function hourOf(time: string): number {
  return Number(time.slice(0, 2));
}

function pad(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Every whole hour the student marked themselves free on, per day. */
function statedSlots(preferences: NormalizedSchedulePreferences): Map<ScheduleDay, Set<number>> {
  const byDay = new Map<ScheduleDay, Set<number>>();
  for (const entry of preferences.dayRanges) {
    const hours = byDay.get(entry.day) ?? new Set<number>();
    for (const range of entry.ranges) {
      const from = hourOf(range.start);
      // A class that STARTS at the end of the window does not fit inside it,
      // so the last startable hour is one before the range closes.
      const to = hourOf(range.end) - 1;
      for (let hour = Math.max(from, EARLIEST_HOUR); hour <= Math.min(to, LATEST_HOUR); hour += 1) {
        hours.add(hour);
      }
    }
    byDay.set(entry.day, hours);
  }
  return byDay;
}

/**
 * Weight per hour of the day from the behaviour profile, normalised to 0-1
 * against the learner's own busiest hour.
 */
function observedWeights(profile: BehaviourProfile | null): number[] {
  const empty = new Array(24).fill(0);
  if (!profile) return empty;
  const peak = Math.max(...profile.signals.hourHistogram);
  if (peak <= 0) return empty;
  return profile.signals.hourHistogram.map((value) => value / peak);
}

/**
 * When the student is actually on, best first.
 *
 * DELIBERATELY NOT CLAMPED to the bookable window. This describes behaviour,
 * and behaviour does not stop at 9pm — the clamp belongs on what we are
 * willing to SCHEDULE, which is a separate decision applied where candidates
 * are built. Clamping here silently erased the single most useful case the
 * whole mismatch check exists for: the student who ticks Saturday morning and
 * is then demonstrably in the app at ten every night. Told nothing, they book
 * the morning slot and miss it.
 */
function busiestHours(weights: number[], threshold = 0.4): number[] {
  return weights
    .map((weight, hour) => ({ weight, hour }))
    .filter((row) => row.weight >= threshold)
    .sort((a, b) => b.weight - a.weight)
    .map((row) => row.hour);
}

/**
 * Rank the hours this student should actually be offered.
 *
 * `tutorBusyAt` is a set of "day:hour" keys the tutor already has something
 * in. Busy slots are DEMOTED rather than removed: a tutor's existing booking
 * can be moved, and a scheduler that silently hides the one hour that suits
 * a student best is worse than one that shows it with a warning attached.
 */
export function adviseSchedule(input: {
  preferences: NormalizedSchedulePreferences | null;
  profile: BehaviourProfile | null;
  tutorBusyAt?: Set<string>;
  limit?: number;
}): Advice {
  const { preferences, profile } = input;
  const tutorBusyAt = input.tutorBusyAt ?? new Set<string>();
  const limit = input.limit ?? 3;

  const stated = preferences ? statedSlots(preferences) : new Map<ScheduleDay, Set<number>>();
  const hasStated = [...stated.values()].some((hours) => hours.size > 0);
  const observedEvents = profile?.totalEvents ?? 0;
  const observedTrusted = observedEvents >= MIN_EVENTS_FOR_RHYTHM;
  const weights = observedTrusted ? observedWeights(profile) : new Array(24).fill(0);
  const hasObserved = weights.some((weight) => weight > 0);

  const preferredStarts = new Set((preferences?.preferredTimes ?? []).map(hourOf));

  /**
   * Weekday weight, so a student who is only ever on at the weekend is not
   * offered a Tuesday just because Tuesday shares their favourite hour.
   */
  const weekdayWeights = new Array(7).fill(0);
  if (observedTrusted && profile) {
    const peak = Math.max(...profile.signals.weekdayHistogram, 1);
    profile.signals.weekdayHistogram.forEach((value, index) => {
      weekdayWeights[index] = value / peak;
    });
  }

  const candidates: Candidate[] = [];
  for (const day of SCHEDULE_DAYS) {
    const dayIndex = (SCHEDULE_DAYS.indexOf(day) + 1) % 7; // SCHEDULE_DAYS starts Monday; histograms start Sunday.
    const statedHours = stated.get(day);
    // Without stated availability there is no constraint to satisfy, so every
    // hour is a candidate and the behaviour data does all the ranking.
    const hours = statedHours && statedHours.size
      ? [...statedHours]
      : hasStated
        ? []
        : Array.from({ length: LATEST_HOUR - EARLIEST_HOUR + 1 }, (_, index) => EARLIEST_HOUR + index);

    for (const hour of hours) {
      const matchesStated = Boolean(statedHours?.has(hour));
      const observedWeight = weights[hour] ?? 0;
      const matchesObserved = observedWeight >= 0.4;
      const busy = tutorBusyAt.has(`${day}:${hour}`);

      const reasons: string[] = [];
      let score = 0;

      if (matchesStated) {
        score += 45;
        reasons.push(`you marked yourself free on ${day} at this time`);
      }
      if (preferredStarts.has(hour)) {
        score += 15;
        reasons.push("it is one of the start times you asked for");
      }
      if (observedTrusted) {
        score += Math.round(observedWeight * 30);
        score += Math.round((weekdayWeights[dayIndex] ?? 0) * 10);
        if (matchesObserved) {
          reasons.push(`you are usually in the app around ${hourLabel(hour)}`);
        }
      }
      if (busy) {
        score -= 25;
        reasons.push("your tutor already has something around then");
      }

      candidates.push({
        day,
        start: pad(hour),
        hour,
        score: Math.max(0, Math.min(100, score)),
        reasons,
        matchesStated,
        matchesObserved,
        tutorBusy: busy,
      });
    }
  }

  /**
   * One suggestion per day. Three near-identical Tuesday slots is not a choice,
   * it is the same recommendation printed three times, and it hides the fact
   * that the student may prefer a different day entirely.
   */
  const bestPerDay = new Map<ScheduleDay, Candidate>();
  for (const candidate of candidates) {
    const held = bestPerDay.get(candidate.day);
    if (!held || candidate.score > held.score) bestPerDay.set(candidate.day, candidate);
  }
  const ranked = [...bestPerDay.values()].sort((a, b) => b.score - a.score).slice(0, limit);

  /* ---- Where the two kinds of evidence disagree ----------------------- */
  const statedHourList = [...new Set([...stated.values()].flatMap((hours) => [...hours]))].sort((a, b) => a - b);
  const observedHourList = busiestHours(weights);
  let mismatch: Advice["mismatch"] = null;
  if (hasStated && observedTrusted && observedHourList.length) {
    const overlap = observedHourList.filter((hour) => statedHourList.includes(hour));
    if (overlap.length === 0) {
      mismatch = {
        statedHours: statedHourList,
        observedHours: observedHourList,
        note:
          `You said you are free around ${statedHourList.map(hourLabel).join(", ")}, ` +
          `but you are almost always in the app around ${observedHourList.slice(0, 2).map(hourLabel).join(" and ")}. ` +
          "Worth checking which one really suits you before the tutor locks it in.",
      };
    }
  }

  return {
    candidates: ranked,
    mismatch,
    evidence: { hasStated, hasObserved, observedEvents, observedTrusted },
    fallbackMessage: writeFallback(ranked, mismatch, { hasStated, observedTrusted }, profile),
  };
}

/**
 * The message shown when no language model is available.
 *
 * Written to be genuinely good rather than a placeholder — this is what a
 * student sees whenever the API key is missing, out of credit, or slow, and a
 * feature that is only good when the network cooperates is not a feature.
 */
function writeFallback(
  ranked: Candidate[],
  mismatch: Advice["mismatch"],
  evidence: { hasStated: boolean; observedTrusted: boolean },
  profile: BehaviourProfile | null,
): string {
  if (!ranked.length) {
    return evidence.hasStated
      ? "Mark a day and a time you are free and I will work out the best slot for you."
      : "Tell me which days work and I will find the hour you are most likely to actually make.";
  }

  const lines: string[] = [];
  const best = ranked[0];
  const dayName = WEEKDAY_NAMES[(SCHEDULE_DAYS.indexOf(best.day) + 1) % 7];
  lines.push(`My pick is ${dayName} at ${hourLabel(best.hour)} — ${best.reasons[0] ?? "it fits what you told me"}.`);

  if (ranked.length > 1) {
    lines.push(
      `Failing that: ${ranked
        .slice(1)
        .map((candidate) => `${WEEKDAY_NAMES[(SCHEDULE_DAYS.indexOf(candidate.day) + 1) % 7]} at ${hourLabel(candidate.hour)}`)
        .join(", or ")}.`,
    );
  }

  if (mismatch) lines.push(mismatch.note);
  else if (evidence.observedTrusted && profile?.peakHour !== null && profile) {
    lines.push(`For what it is worth, you are usually studying around ${hourLabel(profile.peakHour!)}.`);
  }

  if (ranked.some((candidate) => candidate.tutorBusy)) {
    lines.push("One of those clashes with something already in your tutor's diary, so they may come back with a nudge either side.");
  }
  return lines.join(" ");
}
