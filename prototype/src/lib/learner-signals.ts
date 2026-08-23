/**
 * THE READING OF WHAT LEARNERS DO — pure functions, no database.
 *
 * Everything in this file takes an array of events and returns numbers. There
 * is no Prisma import and there never should be: this is the part that has to
 * be TESTABLE, because a behaviour score that silently drifts is worse than no
 * score at all. Somebody will eventually make a decision about a real student
 * on the strength of a number produced here — chase them for a payment, ring
 * them about dropping out, put them in a group. That is the standard the
 * arithmetic is held to, and it is why every derived figure below is defined
 * in one place with the reasoning written down rather than assembled inline in
 * whichever screen happened to need it first.
 *
 * TWO RULES THIS FILE KEEPS.
 *
 *  1. NOTHING HERE INVENTS A FACT. Every output traces to events that actually
 *     happened. Where there is not enough evidence, the answer is "not enough
 *     evidence" (`newcomer`, a null peak hour) rather than a confident-looking
 *     zero. A dashboard that prints "0% engaged" for somebody who enrolled
 *     yesterday is lying with a straight face.
 *
 *  2. THE UNITS ARE THE LEARNER'S, NOT THE SERVER'S. Hours and weekdays come
 *     stamped off the browser clock. Our hosting region has no opinion about
 *     whether somebody studies at midnight.
 */

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export type RawEvent = {
  area: string;
  action: string;
  path?: string | null;
  detail?: string | null;
  deviceKind?: string | null;
  hourLocal?: number | null;
  weekday?: number | null;
  sessionKey?: string | null;
  durationSeconds: number;
  occurredAt: Date | string;
};

export type Sitting = {
  key: string;
  startedAt: Date;
  endedAt: Date;
  minutes: number;
  events: number;
  areas: string[];
};

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * How far back a profile looks. Long enough to see a habit, short enough that
 * last term's behaviour does not outvote this month's.
 */
export const WINDOW_DAYS = 60;

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Shannon entropy of a distribution, normalised to 0-1 against the flattest
 * possible distribution of the same width.
 *
 * Used as the raw material for "predictability". Entropy is the right tool
 * here and a plain standard deviation is not: hours of the day wrap around
 * (23:00 and 01:00 are an hour apart, not twenty-two), so the SPREAD of the
 * timings is meaningless while their CONCENTRATION is exactly the question.
 * A learner who is always on at either 6am or 6pm and never otherwise is
 * highly predictable despite an enormous variance.
 */
export function normalisedEntropy(weights: number[]): number {
  const total = weights.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0 || weights.length < 2) return 0;
  let entropy = 0;
  for (const weight of weights) {
    const p = Math.max(0, weight) / total;
    if (p > 0) entropy -= p * Math.log(p);
  }
  return entropy / Math.log(weights.length);
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/* -------------------------------------------------------------------------- */
/* Sittings                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Collapse events into visits.
 *
 * The browser hands us a `sessionKey` that survives navigation within one tab,
 * which is the honest boundary — it knows when the tab was opened and we do
 * not. Events from before that column existed have no key; rather than throw
 * them away we fall back to a 30-minute idle gap, the rule web analytics has
 * used since the 1990s, which is approximately right and never worse than
 * treating a whole day as one sitting.
 */
export function buildSittings(events: RawEvent[]): Sitting[] {
  const sorted = [...events].sort((a, b) => asDate(a.occurredAt).getTime() - asDate(b.occurredAt).getTime());
  const sittings: Sitting[] = [];
  const byKey = new Map<string, Sitting>();
  const GAP_MS = 30 * 60 * 1000;
  let fallbackIndex = 0;
  let lastFallbackAt = 0;

  for (const event of sorted) {
    const at = asDate(event.occurredAt);
    let key = event.sessionKey || "";
    if (!key) {
      if (!lastFallbackAt || at.getTime() - lastFallbackAt > GAP_MS) fallbackIndex += 1;
      lastFallbackAt = at.getTime();
      key = `gap-${fallbackIndex}`;
    }
    const existing = byKey.get(key);
    if (existing) {
      existing.endedAt = at;
      existing.events += 1;
      existing.minutes += event.durationSeconds / 60;
      if (!existing.areas.includes(event.area)) existing.areas.push(event.area);
      continue;
    }
    const sitting: Sitting = {
      key,
      startedAt: at,
      endedAt: at,
      minutes: event.durationSeconds / 60,
      events: 1,
      areas: [event.area],
    };
    byKey.set(key, sitting);
    sittings.push(sitting);
  }

  /**
   * A sitting's length is the greater of the dwell time we measured and the
   * wall-clock span it covered. Dwell alone under-counts — we only bill time
   * to a page the learner navigated AWAY from, so the last page of every visit
   * is free. Wall clock alone over-counts a tab left open at lunch, which is
   * why the per-event dwell is capped at ingest rather than here.
   */
  for (const sitting of sittings) {
    const span = (sitting.endedAt.getTime() - sitting.startedAt.getTime()) / 60000;
    sitting.minutes = round(Math.max(sitting.minutes, span), 1);
  }
  return sittings;
}

/* -------------------------------------------------------------------------- */
/* The profile                                                                 */
/* -------------------------------------------------------------------------- */

export type BehaviourSignals = {
  /** Seconds of attention per hour of the learner's day, 24 buckets. */
  hourHistogram: number[];
  /** Seconds per weekday, index 0 = Sunday. */
  weekdayHistogram: number[];
  /** Where the attention went. Share is of total measured seconds. */
  areaMix: Array<{ area: string; seconds: number; events: number; share: number }>;
  /** What they actually pressed, most-pressed first. */
  topActions: Array<{ label: string; count: number }>;
  devices: Array<{ kind: string; share: number }>;
  /** Consecutive days with at least one event, ending today or yesterday. */
  currentStreak: number;
  longestStreak: number;
  /** Change in attention: second half of the window against the first, -1..+1. */
  trend: number;
  /** Median gap between visits, in days. A rhythm you can set a clock by. */
  medianGapDays: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  totalMinutes: number;
};

export type BehaviourProfile = {
  archetype: ArchetypeKey;
  peakHour: number | null;
  peakWeekday: number | null;
  sessionsPerWeek: number;
  avgSessionMinutes: number;
  predictability: number;
  engagementScore: number;
  riskScore: number;
  daysSinceSeen: number | null;
  totalEvents: number;
  activeDays: number;
  signals: BehaviourSignals;
};

/**
 * Turn one learner's events into one learner's profile.
 *
 * `now` is a parameter and not `new Date()` so the tests can pin it. Every
 * recency-sensitive number in here would otherwise be untestable.
 */
export function buildProfile(events: RawEvent[], now: Date = new Date()): BehaviourProfile {
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86400000);
  const inWindow = events
    .map((event) => ({ ...event, at: asDate(event.occurredAt) }))
    .filter((event) => event.at >= windowStart && event.at <= new Date(now.getTime() + 60000))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const hourHistogram = new Array(24).fill(0);
  const weekdayHistogram = new Array(7).fill(0);
  const areaSeconds = new Map<string, { seconds: number; events: number }>();
  const actionCounts = new Map<string, number>();
  const deviceCounts = new Map<string, number>();
  const days = new Set<string>();
  let totalSeconds = 0;

  for (const event of inWindow) {
    const seconds = Math.max(0, event.durationSeconds || 0);
    totalSeconds += seconds;
    // Fall back to the server clock only where the browser did not stamp one.
    const hour = event.hourLocal ?? event.at.getUTCHours();
    const weekday = event.weekday ?? event.at.getUTCDay();
    // A click carries no dwell time but is still evidence of being present, so
    // it contributes a nominal 1 rather than nothing at all — otherwise a
    // learner who only ever taps buttons has an empty clock histogram.
    if (hour >= 0 && hour < 24) hourHistogram[hour] += seconds || 1;
    if (weekday >= 0 && weekday < 7) weekdayHistogram[weekday] += seconds || 1;

    const area = areaSeconds.get(event.area) ?? { seconds: 0, events: 0 };
    area.seconds += seconds;
    area.events += 1;
    areaSeconds.set(event.area, area);

    if (event.action !== "view") {
      const label = event.detail ? `${event.action}: ${event.detail}` : event.action;
      actionCounts.set(label, (actionCounts.get(label) ?? 0) + 1);
    }
    if (event.deviceKind) deviceCounts.set(event.deviceKind, (deviceCounts.get(event.deviceKind) ?? 0) + 1);
    days.add(dayKey(event.at));
  }

  const sittings = buildSittings(inWindow);
  const observedDays = inWindow.length
    ? Math.max(1, (now.getTime() - inWindow[0].at.getTime()) / 86400000)
    : 0;
  const sessionsPerWeek = observedDays > 0 ? round((sittings.length / observedDays) * 7, 1) : 0;
  const avgSessionMinutes = sittings.length
    ? round(sittings.reduce((sum, sitting) => sum + sitting.minutes, 0) / sittings.length, 1)
    : 0;

  const lastSeenAt = inWindow.length ? inWindow[inWindow.length - 1].at : null;
  const daysSinceSeen = lastSeenAt ? Math.floor((now.getTime() - lastSeenAt.getTime()) / 86400000) : null;

  const peakHour = peakOf(hourHistogram);
  const peakWeekday = peakOf(weekdayHistogram);

  /**
   * PREDICTABILITY. Two thirds hour-of-day, one third day-of-week, because
   * "always at 9pm" is a far stronger habit than "always sometime on a
   * Tuesday". Inverted entropy: a learner spread evenly across the clock
   * scores 0, one who only ever appears in a single hour scores 1.
   */
  const predictability = round(
    clamp(0.67 * (1 - normalisedEntropy(hourHistogram)) + 0.33 * (1 - normalisedEntropy(weekdayHistogram)), 0, 1),
    2,
  );

  const half = new Date(now.getTime() - (WINDOW_DAYS / 2) * 86400000);
  const firstHalf = inWindow.filter((event) => event.at < half).reduce((sum, e) => sum + Math.max(0, e.durationSeconds || 0), 0);
  const secondHalf = totalSeconds - firstHalf;
  const trend = firstHalf + secondHalf > 0 ? round((secondHalf - firstHalf) / (firstHalf + secondHalf), 2) : 0;

  const { current: currentStreak, longest: longestStreak } = streaks([...days].sort(), now);
  const medianGapDays = medianGap(sittings);

  /**
   * ENGAGEMENT, 0-100. Recency, frequency and depth — the same three legs the
   * rest of the industry calls RFM, because they are the three that matter and
   * they fail independently. Somebody can be here every day for ninety seconds
   * (frequent, shallow), or vanish for a fortnight and then read for two hours
   * (deep, stale). A single average would call both of them "medium" and tell
   * you nothing you could act on.
   */
  const recencyLeg = daysSinceSeen === null ? 0 : clamp(1 - daysSinceSeen / 21, 0, 1);
  const frequencyLeg = clamp(days.size / Math.min(WINDOW_DAYS, Math.max(7, observedDays)), 0, 1);
  const depthLeg = clamp(avgSessionMinutes / 20, 0, 1);
  const engagementScore = Math.round(100 * (0.45 * recencyLeg + 0.35 * frequencyLeg + 0.2 * depthLeg));

  /**
   * RISK, 0-100. NOT simply "100 minus engagement" — that would make the two
   * columns one column wearing a hat. Risk is about the DERIVATIVE: a learner
   * at 40% engagement who is climbing is fine, and a learner at 70% who has
   * halved in a fortnight is the one to ring. Silence dominates, decline is
   * the second term, and a thin floor of activity is the third.
   */
  const silence = daysSinceSeen === null ? 1 : clamp(daysSinceSeen / 14, 0, 1);
  const decline = clamp(-trend, 0, 1);
  const thinness = 1 - frequencyLeg;
  const riskScore = inWindow.length === 0
    ? 100
    : Math.round(100 * clamp(0.55 * silence + 0.3 * decline + 0.15 * thinness, 0, 1));

  const areaMix = [...areaSeconds.entries()]
    .map(([area, value]) => ({
      area,
      seconds: value.seconds,
      events: value.events,
      share: totalSeconds > 0 ? round(value.seconds / totalSeconds, 3) : 0,
    }))
    .sort((a, b) => b.seconds - a.seconds);

  const deviceTotal = [...deviceCounts.values()].reduce((sum, value) => sum + value, 0);

  const signals: BehaviourSignals = {
    hourHistogram,
    weekdayHistogram,
    areaMix,
    topActions: [...actionCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    devices: [...deviceCounts.entries()]
      .map(([kind, count]) => ({ kind, share: deviceTotal ? round(count / deviceTotal, 2) : 0 }))
      .sort((a, b) => b.share - a.share),
    currentStreak,
    longestStreak,
    trend,
    medianGapDays,
    firstSeen: inWindow.length ? inWindow[0].at.toISOString() : null,
    lastSeen: lastSeenAt ? lastSeenAt.toISOString() : null,
    totalMinutes: round(totalSeconds / 60, 1),
  };

  const partial: Omit<BehaviourProfile, "archetype"> = {
    peakHour,
    peakWeekday,
    sessionsPerWeek,
    avgSessionMinutes,
    predictability,
    engagementScore,
    riskScore,
    daysSinceSeen,
    totalEvents: inWindow.length,
    activeDays: days.size,
    signals,
  };

  return { ...partial, archetype: classify(partial) };
}

function peakOf(histogram: number[]): number | null {
  let best = 0;
  let bestIndex: number | null = null;
  histogram.forEach((value, index) => {
    if (value > best) {
      best = value;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function streaks(sortedDays: string[], now: Date): { current: number; longest: number } {
  if (!sortedDays.length) return { current: 0, longest: 0 };
  let longest = 1;
  let run = 1;
  for (let index = 1; index < sortedDays.length; index += 1) {
    const previous = Date.parse(`${sortedDays[index - 1]}T00:00:00Z`);
    const current = Date.parse(`${sortedDays[index]}T00:00:00Z`);
    run = current - previous === 86400000 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  // A streak only counts as CURRENT if it reaches today or yesterday. Anything
  // older is a run that already ended, and calling it live is how a dashboard
  // congratulates somebody who left three weeks ago.
  const lastDay = Date.parse(`${sortedDays[sortedDays.length - 1]}T00:00:00Z`);
  const today = Date.parse(`${dayKey(now)}T00:00:00Z`);
  const current = today - lastDay <= 86400000 ? run : 0;
  return { current, longest };
}

function medianGap(sittings: Sitting[]): number | null {
  if (sittings.length < 3) return null;
  const gaps: number[] = [];
  for (let index = 1; index < sittings.length; index += 1) {
    gaps.push((sittings[index].startedAt.getTime() - sittings[index - 1].startedAt.getTime()) / 86400000);
  }
  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const value = gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
  return round(value, 1);
}

/* -------------------------------------------------------------------------- */
/* Archetypes                                                                  */
/* -------------------------------------------------------------------------- */

export const ARCHETYPES = {
  newcomer:        { label: "Settling in",     blurb: "Too new to have a habit yet. Give it a fortnight before reading anything into the numbers.", tone: "neutral" },
  ghost:           { label: "Gone quiet",      blurb: "Has not opened the portal in over a fortnight. The single strongest predictor of dropping out.", tone: "bad" },
  fading:          { label: "Fading",          blurb: "Still here, but on a clear downward slope. This is the window where a phone call still works.", tone: "bad" },
  night_owl:       { label: "Night owl",       blurb: "Studies late — after 9pm, most nights. Put reminders in the evening, never the morning.", tone: "good" },
  early_bird:      { label: "Early bird",      blurb: "On before the day starts. Dawn is when their attention is cheapest to buy.", tone: "good" },
  lunch_breaker:   { label: "Lunch breaker",   blurb: "Studies in the middle of the working day, in short bursts. Almost certainly fitting it around a job.", tone: "neutral" },
  weekend_crammer: { label: "Weekend crammer", blurb: "Does the whole week's work on Saturday and Sunday. Weekday homework deadlines will keep being missed.", tone: "neutral" },
  clockwork:       { label: "Clockwork",       blurb: "Same hour, same days, week after week. The most reliable learner you have — and the easiest to schedule around.", tone: "good" },
  binger:          { label: "Binger",          blurb: "Rare but very long sittings. Depth of content matters to them far more than reminders do.", tone: "neutral" },
  skimmer:         { label: "Skimmer",         blurb: "Opens often, stays barely a minute. Present without engaging — the pattern that quietly precedes fading.", tone: "warn" },
  social:          { label: "Community-first", blurb: "Comes for the people, not the lessons. Peer nudges reach them; content emails do not.", tone: "neutral" },
  grinder:         { label: "Grinder",         blurb: "Heavy, consistent time on lessons and practice. Statistically, your top of the class.", tone: "good" },
  steady:          { label: "Steady",          blurb: "Regular and unremarkable, in the good sense. No intervention needed.", tone: "good" },
} as const;

export type ArchetypeKey = keyof typeof ARCHETYPES;

/**
 * Which single label best describes this person.
 *
 * ORDER IS THE DESIGN. Risk states are tested first, because "she is a night
 * owl" is useless information about somebody who has not logged in since July.
 * Only once we know they are actually here do we ask what kind of "here" it
 * is: what surface they live on, then what rhythm they keep. Every learner
 * lands somewhere, and `steady` is the honest bottom of the list rather than
 * a flattering invention.
 */
export function classify(profile: Omit<BehaviourProfile, "archetype">): ArchetypeKey {
  const { signals } = profile;
  if (profile.totalEvents < 8 || profile.activeDays < 3) return "newcomer";
  if (profile.daysSinceSeen !== null && profile.daysSinceSeen >= 14) return "ghost";
  if (signals.trend <= -0.45 && profile.riskScore >= 45) return "fading";

  const weekendSeconds = signals.weekdayHistogram[0] + signals.weekdayHistogram[6];
  const weekTotal = signals.weekdayHistogram.reduce((sum, value) => sum + value, 0);
  if (weekTotal > 0 && weekendSeconds / weekTotal >= 0.6) return "weekend_crammer";

  const top = signals.areaMix[0];
  if (top && top.share >= 0.45 && /communit|chat|message/i.test(top.area)) return "social";

  if (profile.avgSessionMinutes >= 25 && profile.sessionsPerWeek <= 2.5) return "binger";
  if (profile.avgSessionMinutes <= 2 && profile.sessionsPerWeek >= 4) return "skimmer";

  const hour = profile.peakHour;
  if (hour !== null && (hour >= 21 || hour <= 4)) return "night_owl";
  if (hour !== null && hour >= 5 && hour <= 8) return "early_bird";
  if (hour !== null && hour >= 11 && hour <= 14 && profile.avgSessionMinutes <= 12) return "lunch_breaker";

  if (profile.predictability >= 0.55 && profile.sessionsPerWeek >= 3) return "clockwork";
  if (profile.engagementScore >= 70 && profile.avgSessionMinutes >= 12) return "grinder";
  return "steady";
}

/* -------------------------------------------------------------------------- */
/* Group psychology                                                            */
/* -------------------------------------------------------------------------- */

export type CohortMember = {
  userId: string;
  name: string;
  group: string;
  profile: Pick<
    BehaviourProfile,
    "archetype" | "engagementScore" | "riskScore" | "predictability" | "peakHour" | "avgSessionMinutes" | "sessionsPerWeek"
  > & {
    signals: Pick<BehaviourSignals, "areaMix" | "hourHistogram" | "weekdayHistogram">;
  };
};

export type FeatureLift = {
  area: string;
  /** This group's share of attention on this surface. */
  groupShare: number;
  /** The whole school's share. */
  schoolShare: number;
  /** groupShare / schoolShare. 1.4 = this group uses it 40% more than average. */
  lift: number;
  learners: number;
};

/**
 * WHAT MAKES THIS GROUP DIFFERENT FROM THE SCHOOL.
 *
 * A raw ranking of "most used features" in a group is almost worthless,
 * because every group's list is the same list: the dashboard is always first,
 * lessons are always second. What carries information is the DEPARTURE from
 * the average — the surface this group leans on harder than everybody else
 * does. That ratio is the lift, and it is the whole of what recommendation
 * systems mean by an affinity.
 *
 * Guarded on sample size on purpose. With four learners in a group, one person
 * discovering the video library reads as a 6x lift and means nothing; the
 * `learners` count travels with every row so the screen can say so out loud
 * rather than presenting noise as an insight.
 */
export function featureLift(group: CohortMember[], school: CohortMember[]): FeatureLift[] {
  const share = (members: CohortMember[]) => {
    const totals = new Map<string, number>();
    let all = 0;
    for (const member of members) {
      for (const row of member.profile.signals.areaMix) {
        totals.set(row.area, (totals.get(row.area) ?? 0) + row.seconds);
        all += row.seconds;
      }
    }
    return { totals, all };
  };
  const learnersOn = new Map<string, number>();
  for (const member of group) {
    for (const row of member.profile.signals.areaMix) {
      if (row.seconds > 0) learnersOn.set(row.area, (learnersOn.get(row.area) ?? 0) + 1);
    }
  }

  const groupTotals = share(group);
  const schoolTotals = share(school);
  const rows: FeatureLift[] = [];
  for (const [area, seconds] of groupTotals.totals) {
    const gs = groupTotals.all > 0 ? seconds / groupTotals.all : 0;
    const ss = schoolTotals.all > 0 ? (schoolTotals.totals.get(area) ?? 0) / schoolTotals.all : 0;
    if (ss <= 0) continue;
    rows.push({
      area,
      groupShare: round(gs, 3),
      schoolShare: round(ss, 3),
      lift: round(gs / ss, 2),
      learners: learnersOn.get(area) ?? 0,
    });
  }
  return rows.sort((a, b) => b.lift - a.lift);
}

export type CohortReading = {
  group: string;
  learners: number;
  avgEngagement: number;
  avgRisk: number;
  atRisk: number;
  /** How many of the group we have enough behaviour on to say anything about. */
  measured: number;
  /** The hour this group is most often on, collectively. */
  peakHour: number | null;
  /** How alike the group is: 1 = they all behave identically. */
  cohesion: number;
  archetypes: Array<{ key: ArchetypeKey; label: string; count: number; share: number }>;
  distinctive: FeatureLift[];
};

/**
 * Read a whole cohort — a class, a level, a branch.
 *
 * `cohesion` is the number that answers "is this a group or just a list". It
 * is one minus the entropy of the archetype spread: a class where everybody is
 * a night owl scores near 1 and can be treated as a unit, a class split evenly
 * across nine archetypes scores near 0 and any blanket action taken on it will
 * be wrong for most of its members.
 */
export function readCohort(group: CohortMember[], school: CohortMember[], groupName: string): CohortReading {
  const counts = new Map<ArchetypeKey, number>();
  const hours = new Array(24).fill(0);
  let engagement = 0;
  let risk = 0;
  let atRisk = 0;
  let measured = 0;

  for (const member of group) {
    counts.set(member.profile.archetype, (counts.get(member.profile.archetype) ?? 0) + 1);
    member.profile.signals.hourHistogram.forEach((value, index) => {
      hours[index] += value;
    });
    engagement += member.profile.engagementScore;
    risk += member.profile.riskScore;
    /**
     * A NEWCOMER IS NOT AT RISK, THEY ARE UNMEASURED.
     *
     * Everybody we have never seen scores 100 for risk, which is correct as
     * arithmetic — silence is exactly what a risk score is measuring — and
     * wrong as a claim about a person. Counting them here produced "135
     * learners · 135 at risk" on a level that had simply never been observed,
     * which is not a warning, it is noise loud enough to drown the four real
     * warnings sitting next to it.
     */
    if (member.profile.archetype === "newcomer") continue;
    measured += 1;
    if (member.profile.riskScore >= 60) atRisk += 1;
  }

  const size = group.length || 1;
  const spread = [...counts.values()];
  /**
   * Cohesion is a statement about HABITS being alike. A group where nobody has
   * a habit yet is not cohesive, it is unread — and reporting 1.0 for it told
   * the school it could safely treat the level as a unit on the strength of no
   * evidence whatsoever.
   */
  const cohesion = measured >= 5
    ? round(1 - normalisedEntropy(spread.length > 1 ? spread : [1, 0]), 2)
    : 0;
  return {
    group: groupName,
    learners: group.length,
    measured,
    avgEngagement: Math.round(engagement / size),
    avgRisk: Math.round(risk / size),
    atRisk,
    peakHour: peakOf(hours),
    cohesion,
    archetypes: [...counts.entries()]
      .map(([key, count]) => ({ key, label: ARCHETYPES[key].label, count, share: round(count / size, 2) }))
      .sort((a, b) => b.count - a.count),
    distinctive: featureLift(group, school)
      .filter((row) => row.learners >= 3 && (row.lift >= 1.25 || row.lift <= 0.75))
      .slice(0, 5),
  };
}

/* -------------------------------------------------------------------------- */
/* Saying it in English                                                        */
/* -------------------------------------------------------------------------- */

export function hourLabel(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "midday";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/**
 * One sentence a human can act on.
 *
 * This exists because a page of scores is not an insight, it is homework. The
 * front desk should be able to read one line and know what to do, without
 * first being taught what a normalised entropy is.
 */
export function describe(profile: BehaviourProfile, name = "This student"): string {
  if (profile.totalEvents === 0) return `${name} has not opened the portal at all in the last ${WINDOW_DAYS} days.`;

  /**
   * A HANDFUL OF VISITS IS NOT A RHYTHM.
   *
   * The arithmetic below is happy to turn five page views into "usually on
   * around midnight, about 14 visits a week" — extrapolated from a single
   * evening, stated with the same confidence as a reading of six weeks. The
   * archetype already knows this person is unread; the sentence has to say so
   * rather than dressing the same thin data up as a habit.
   */
  if (profile.archetype === "newcomer") {
    return (
      `${name} has ${profile.totalEvents} recorded movement${profile.totalEvents === 1 ? "" : "s"} across ` +
      `${profile.activeDays} day${profile.activeDays === 1 ? "" : "s"} — too little to read a habit from yet. ` +
      "Come back in a fortnight."
    );
  }

  const parts: string[] = [];
  if (profile.peakHour !== null && profile.predictability >= 0.35) {
    parts.push(`usually on around ${hourLabel(profile.peakHour)}`);
  }
  if (profile.peakWeekday !== null && profile.sessionsPerWeek < 6) {
    parts.push(`most often on a ${WEEKDAY_NAMES[profile.peakWeekday]}`);
  }
  parts.push(
    `about ${profile.sessionsPerWeek} visit${profile.sessionsPerWeek === 1 ? "" : "s"} a week of ${profile.avgSessionMinutes} minutes`,
  );

  const rhythm = `${name} is ${parts.join(", ")}.`;
  const surface = profile.signals.areaMix[0]
    ? ` Most of that time goes to ${profile.signals.areaMix[0].area} (${Math.round(profile.signals.areaMix[0].share * 100)}%).`
    : "";
  const state = profile.riskScore >= 60
    ? ` Attention is down and they have not been seen for ${profile.daysSinceSeen} day${profile.daysSinceSeen === 1 ? "" : "s"} — worth a call.`
    : profile.signals.trend >= 0.3
      ? " Their activity is climbing."
      : "";
  return `${rhythm}${surface}${state}`;
}

/**
 * The hours this learner is reliably awake and on, best first.
 *
 * Used by the private-class scheduler: the point of knowing somebody is a
 * night owl is being able to offer them a 9pm slot instead of putting them in
 * a 10am one they will miss. Only returns hours carrying real weight — one
 * stray 3am visit should not become a scheduling recommendation.
 */
export function bestHours(profile: BehaviourProfile, count = 3): number[] {
  const total = profile.signals.hourHistogram.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  return profile.signals.hourHistogram
    .map((seconds, hour) => ({ hour, weight: seconds / total }))
    .filter((row) => row.weight >= 0.05)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, count)
    .map((row) => row.hour);
}
