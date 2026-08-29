import { prisma } from "@/lib/prisma";
import {
  ARCHETYPES,
  WINDOW_DAYS,
  buildProfile,
  describe,
  readCohort,
  type ArchetypeKey,
  type BehaviourProfile,
  type CohortMember,
  type CohortReading,
  type RawEvent,
} from "@/lib/learner-signals";

/**
 * THE DATABASE HALF OF THE BEHAVIOUR ENGINE.
 *
 * `learner-signals.ts` does the thinking and touches no tables; this file
 * fetches, caches and serves. The split is deliberate — the arithmetic is
 * where the mistakes hide, so it lives somewhere a unit test can reach it
 * without a Postgres connection.
 *
 * WHY THERE IS A CACHE TABLE. Reading one learner's rhythm means scanning
 * every event they generated in sixty days. Reading the school means doing
 * that two hundred times. Doing it on page load would be a slow screen today
 * and an outage next term. `LearnerBehaviourProfile` holds the answer, and
 * `refreshProfiles` rebuilds whatever has gone stale. Nothing in the table is
 * a source of truth: truncate it and the next read regenerates it.
 */

/** How long a cached profile is trusted before it is rebuilt. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Learners per round trip.
 *
 * Rebuilding is done in chunks rather than one learner at a time OR all at
 * once, and both of those were tried. One at a time is 200-odd sequential
 * round trips to a Postgres in Frankfurt and takes minutes — the first version
 * of this file did exactly that and the admin screen simply never finished
 * loading. All at once means a single query that could pull half a million
 * event rows into memory to answer a question about two hundred people.
 */
const CHUNK = 25;

/**
 * Ceiling on rows pulled per learner per refresh. A student generating more
 * than this in sixty days is either extraordinarily active or a bug; either
 * way the newest few thousand describe them perfectly well, and an unbounded
 * query is how one pathological row set takes the admin screen down.
 */
const MAX_EVENTS_PER_LEARNER = 4000;

/**
 * How many stale profiles one ORDINARY page load is allowed to rebuild.
 *
 * The screen must return in a usable time on a school that has never computed
 * anything, so a plain GET does a bounded amount of work and shows what it
 * has; the next load picks up where it left off. "Recompute now" passes
 * `force` and is not capped, because somebody has asked for it and is
 * watching a spinner they chose.
 */
const MAX_LAZY_REFRESH = 60;

export type StoredProfile = BehaviourProfile & {
  userId: string;
  computedAt: Date;
};

function toStored(row: {
  userId: string;
  archetype: string;
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
  signals: unknown;
  computedAt: Date;
}): StoredProfile {
  return {
    userId: row.userId,
    archetype: (row.archetype in ARCHETYPES ? row.archetype : "newcomer") as ArchetypeKey,
    peakHour: row.peakHour,
    peakWeekday: row.peakWeekday,
    sessionsPerWeek: row.sessionsPerWeek,
    avgSessionMinutes: row.avgSessionMinutes,
    predictability: row.predictability,
    engagementScore: row.engagementScore,
    riskScore: row.riskScore,
    daysSinceSeen: row.daysSinceSeen,
    totalEvents: row.totalEvents,
    activeDays: row.activeDays,
    signals: (row.signals ?? emptySignals()) as BehaviourProfile["signals"],
    computedAt: row.computedAt,
  };
}

function emptySignals(): BehaviourProfile["signals"] {
  return {
    hourHistogram: new Array(24).fill(0),
    weekdayHistogram: new Array(7).fill(0),
    areaMix: [],
    topActions: [],
    devices: [],
    currentStreak: 0,
    longestStreak: 0,
    trend: 0,
    medianGapDays: null,
    firstSeen: null,
    lastSeen: null,
    totalMinutes: 0,
  };
}

/**
 * Rebuild the cached profiles for the given users.
 *
 * `force` bypasses the staleness check — used by the "Recompute now" button so
 * an admin who has just changed something can see it take effect rather than
 * being told to come back in six hours.
 */
export async function refreshProfiles(userIds: string[], options: { force?: boolean } = {}): Promise<number> {
  if (!userIds.length) return 0;

  const existing = await prisma.learnerBehaviourProfile.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, computedAt: true },
  });
  const freshness = new Map(existing.map((row) => [row.userId, row.computedAt.getTime()]));
  const cutoff = Date.now() - STALE_AFTER_MS;
  const allStale = options.force
    ? userIds
    : userIds.filter((userId) => (freshness.get(userId) ?? 0) < cutoff);
  // Oldest first, so a capped lazy pass works its way through the roster
  // instead of rebuilding the same arbitrary sixty people every time.
  allStale.sort((a, b) => (freshness.get(a) ?? 0) - (freshness.get(b) ?? 0));
  const stale = options.force ? allStale : allStale.slice(0, MAX_LAZY_REFRESH);
  if (!stale.length) return 0;

  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400000);
  let written = 0;

  for (let offset = 0; offset < stale.length; offset += CHUNK) {
    const batch = stale.slice(offset, offset + CHUNK);

    const events = await prisma.learnerUsageEvent.findMany({
      where: { userId: { in: batch }, occurredAt: { gte: since } },
      orderBy: { occurredAt: "desc" },
      take: MAX_EVENTS_PER_LEARNER * batch.length,
      select: {
        userId: true,
        tenantId: true,
        area: true,
        action: true,
        path: true,
        detail: true,
        deviceKind: true,
        hourLocal: true,
        weekday: true,
        sessionKey: true,
        durationSeconds: true,
        occurredAt: true,
      },
    });

    const byUser = new Map<string, RawEvent[]>();
    const tenantOf = new Map<string, string | null>();
    for (const row of events) {
      const bucket = byUser.get(row.userId) ?? [];
      bucket.push(row);
      byUser.set(row.userId, bucket);
      if (!tenantOf.has(row.userId)) tenantOf.set(row.userId, row.tenantId);
    }

    // Learners with no events still need a row — "we have never seen this
    // person" is itself the most actionable reading on the page, and leaving
    // them out of the table is how they quietly vanish from the at-risk list.
    const missingTenants = batch.filter((userId) => !tenantOf.has(userId));
    if (missingTenants.length) {
      const users = await prisma.user.findMany({
        where: { id: { in: missingTenants } },
        select: { id: true, tenantId: true },
      });
      for (const user of users) tenantOf.set(user.id, user.tenantId);
    }

    // In parallel within the chunk: the arithmetic is instant, the round trip
    // is not, and the chunk size is what keeps the connection pool out of
    // trouble. See the pool exhaustion noted in the community launch work.
    await Promise.all(
      batch.map(async (userId) => {
        const profile = buildProfile(byUser.get(userId) ?? [], now);
        /**
         * NO `tenantId` IN HERE, and this is not an oversight.
         *
         * The same object is used for the create and the update. The tenant
         * extension stamps `tenantId` onto the CREATE half of an upsert and
         * deliberately leaves the UPDATE half alone, so a tenantId carried in
         * here would be written verbatim on every subsequent refresh. It came
         * from the learner's event rows, which are null for anyone whose
         * events predate tenancy — so the update quietly erased the stamp, and
         * the NEXT run's tenant-filtered upsert could no longer find the row
         * it had just written. That surfaces as P2025 on a table the request
         * owns outright, which is a confusing way to be told you have
         * un-tenanted your own cache.
         */
        const data = {
          archetype: profile.archetype,
          peakHour: profile.peakHour,
          peakWeekday: profile.peakWeekday,
          sessionsPerWeek: profile.sessionsPerWeek,
          avgSessionMinutes: profile.avgSessionMinutes,
          predictability: profile.predictability,
          engagementScore: profile.engagementScore,
          riskScore: profile.riskScore,
          daysSinceSeen: profile.daysSinceSeen,
          totalEvents: profile.totalEvents,
          activeDays: profile.activeDays,
          signals: profile.signals as unknown as object,
          computedAt: now,
        };
        await prisma.learnerBehaviourProfile.upsert({
          where: { userId },
          // The tenant belongs on the create only. Under a scoped request the
          // extension overwrites this with the caller's tenant; it is here so
          // that an unscoped rebuild (a cron sweep) still stamps the row
          // rather than leaving an unowned one behind.
          create: { userId, tenantId: tenantOf.get(userId) ?? null, ...data },
          update: data,
        });
        written += 1;
      }),
    );
  }
  return written;
}

/** One learner's profile, rebuilt if stale, plus the sentence about them. */
export async function profileFor(userId: string, name?: string): Promise<StoredProfile & { summary: string }> {
  await refreshProfiles([userId]);
  const row = await prisma.learnerBehaviourProfile.findUnique({ where: { userId } });
  const profile = row
    ? toStored(row)
    : { ...buildProfile([], new Date()), userId, computedAt: new Date() };
  return { ...profile, summary: describe(profile, name ?? "This student") };
}

export type SchoolIntelligence = {
  generatedAt: string;
  windowDays: number;
  coverage: {
    /** Students on the roster. */
    students: number;
    /** How many of them we have any behaviour on at all. */
    observed: number;
    /** How many have explicitly opted out of being measured. */
    optedOut: number;
    eventsInWindow: number;
  };
  archetypes: Array<{ key: ArchetypeKey; label: string; blurb: string; tone: string; count: number; share: number }>;
  /** School-wide clock, in the learners' own hours. */
  hourHistogram: number[];
  weekdayHistogram: number[];
  /** Where the school's attention actually goes. */
  surfaces: Array<{ area: string; seconds: number; learners: number; share: number }>;
  /** Cohorts, read as groups rather than as lists of people. */
  cohorts: CohortReading[];
  /** The people worth ringing, worst first. */
  atRisk: Array<{
    userId: string;
    studentId: string | null;
    name: string;
    level: string;
    riskScore: number;
    daysSinceSeen: number | null;
    archetype: ArchetypeKey;
    summary: string;
  }>;
  /** The people to hold up as the example. */
  standouts: Array<{ userId: string; studentId: string | null; name: string; level: string; engagementScore: number; currentStreak: number; archetype: ArchetypeKey }>;
  /** Plain-English findings, ranked by how actionable they are. */
  findings: Array<{ headline: string; detail: string; tone: "good" | "warn" | "bad" | "neutral" }>;
};

/**
 * The whole school, read.
 *
 * Groups students by LEVEL because that is the unit the school already thinks
 * and acts in — a level has one timetable, one set of materials and one tutor
 * team, so a finding about a level is a finding somebody can do something
 * about on Monday. Grouping by branch or by session slot would be equally
 * computable and considerably less useful.
 */
export async function readSchool(): Promise<SchoolIntelligence> {
  const students = await prisma.student.findMany({
    where: { status: { not: "archived" } },
    select: {
      id: true,
      userId: true,
      level: true,
      classType: true,
      user: { select: { id: true, name: true, email: true, analyticsOptOutAt: true } },
    },
  });

  const userIds = students.map((student) => student.userId);
  await refreshProfiles(userIds);

  const [rows, eventCount] = await Promise.all([
    prisma.learnerBehaviourProfile.findMany({ where: { userId: { in: userIds } } }),
    prisma.learnerUsageEvent.count({
      where: { occurredAt: { gte: new Date(Date.now() - WINDOW_DAYS * 86400000) } },
    }),
  ]);
  const profiles = new Map(rows.map((row) => [row.userId, toStored(row)]));

  const members: CohortMember[] = [];
  const hourHistogram = new Array(24).fill(0);
  const weekdayHistogram = new Array(7).fill(0);
  const surfaceSeconds = new Map<string, { seconds: number; learners: Set<string> }>();
  const archetypeCounts = new Map<ArchetypeKey, number>();
  let observed = 0;
  let optedOut = 0;

  for (const student of students) {
    if (student.user.analyticsOptOutAt) {
      optedOut += 1;
      continue;
    }
    const profile = profiles.get(student.userId);
    if (!profile) continue;
    if (profile.totalEvents > 0) observed += 1;

    archetypeCounts.set(profile.archetype, (archetypeCounts.get(profile.archetype) ?? 0) + 1);
    profile.signals.hourHistogram.forEach((value, index) => {
      hourHistogram[index] += value;
    });
    profile.signals.weekdayHistogram.forEach((value, index) => {
      weekdayHistogram[index] += value;
    });
    for (const row of profile.signals.areaMix) {
      const bucket = surfaceSeconds.get(row.area) ?? { seconds: 0, learners: new Set<string>() };
      bucket.seconds += row.seconds;
      if (row.seconds > 0) bucket.learners.add(student.userId);
      surfaceSeconds.set(row.area, bucket);
    }

    members.push({
      userId: student.userId,
      name: student.user.name ?? student.user.email ?? "Unnamed",
      group: student.level,
      profile: {
        archetype: profile.archetype,
        engagementScore: profile.engagementScore,
        riskScore: profile.riskScore,
        predictability: profile.predictability,
        peakHour: profile.peakHour,
        avgSessionMinutes: profile.avgSessionMinutes,
        sessionsPerWeek: profile.sessionsPerWeek,
        signals: {
          areaMix: profile.signals.areaMix,
          hourHistogram: profile.signals.hourHistogram,
          weekdayHistogram: profile.signals.weekdayHistogram,
        },
      },
    });
  }

  const byLevel = new Map<string, CohortMember[]>();
  for (const member of members) {
    const bucket = byLevel.get(member.group) ?? [];
    bucket.push(member);
    byLevel.set(member.group, bucket);
  }
  const cohorts = [...byLevel.entries()]
    // Below five people a "group pattern" is three individuals and a rounding
    // error. Saying so is better than drawing a chart of it.
    .filter(([, group]) => group.length >= 5)
    .map(([name, group]) => readCohort(group, members, name))
    .sort((a, b) => a.group.localeCompare(b.group));

  const studentByUser = new Map(students.map((student) => [student.userId, student]));
  const ranked = [...profiles.values()].filter((profile) => studentByUser.has(profile.userId));

  const atRisk = ranked
    .filter((profile) => profile.riskScore >= 55 && profile.archetype !== "newcomer")
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 20)
    .map((profile) => {
      const student = studentByUser.get(profile.userId)!;
      const name = student.user.name ?? student.user.email ?? "Unnamed";
      return {
        userId: profile.userId,
        studentId: student.id,
        name,
        level: student.level,
        riskScore: profile.riskScore,
        daysSinceSeen: profile.daysSinceSeen,
        archetype: profile.archetype,
        summary: describe(profile, name),
      };
    });

  const standouts = ranked
    .filter((profile) => profile.engagementScore >= 60)
    .sort((a, b) => b.engagementScore - a.engagementScore || b.signals.currentStreak - a.signals.currentStreak)
    .slice(0, 8)
    .map((profile) => {
      const student = studentByUser.get(profile.userId)!;
      return {
        userId: profile.userId,
        studentId: student.id,
        name: student.user.name ?? student.user.email ?? "Unnamed",
        level: student.level,
        engagementScore: profile.engagementScore,
        currentStreak: profile.signals.currentStreak,
        archetype: profile.archetype,
      };
    });

  const totalSurfaceSeconds = [...surfaceSeconds.values()].reduce((sum, row) => sum + row.seconds, 0);
  const surfaces = [...surfaceSeconds.entries()]
    .map(([area, row]) => ({
      area,
      seconds: row.seconds,
      learners: row.learners.size,
      share: totalSurfaceSeconds > 0 ? Math.round((row.seconds / totalSurfaceSeconds) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => b.seconds - a.seconds);

  const counted = members.length || 1;
  return {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    coverage: { students: students.length, observed, optedOut, eventsInWindow: eventCount },
    archetypes: [...archetypeCounts.entries()]
      .map(([key, count]) => ({
        key,
        label: ARCHETYPES[key].label,
        blurb: ARCHETYPES[key].blurb,
        tone: ARCHETYPES[key].tone,
        count,
        share: Math.round((count / counted) * 100) / 100,
      }))
      .sort((a, b) => b.count - a.count),
    hourHistogram,
    weekdayHistogram,
    surfaces,
    cohorts,
    atRisk,
    standouts,
    findings: findingsFrom({ members, cohorts, hourHistogram, surfaces, atRisk, observed, students: students.length }),
  };
}

/**
 * TURN THE NUMBERS INTO SENTENCES.
 *
 * The screens above this could simply print charts, and the school would look
 * at them once. A finding is a chart that has already been read for you: it
 * names the pattern, says how big it is, and implies what to do. Every one is
 * gated on having enough evidence to say it — the alternative is a page that
 * confidently reports a trend among four people.
 */
function findingsFrom(input: {
  members: CohortMember[];
  cohorts: CohortReading[];
  hourHistogram: number[];
  surfaces: Array<{ area: string; seconds: number; learners: number; share: number }>;
  atRisk: SchoolIntelligence["atRisk"];
  observed: number;
  students: number;
}): SchoolIntelligence["findings"] {
  const findings: SchoolIntelligence["findings"] = [];

  if (input.observed < 10) {
    findings.push({
      headline: "Not enough behaviour recorded yet to say anything reliable",
      detail: `Only ${input.observed} of ${input.students} students have generated any usage at all. Patterns start to mean something at about 30. Nothing below is worth acting on until then.`,
      tone: "neutral",
    });
    return findings;
  }

  const total = input.hourHistogram.reduce((sum, value) => sum + value, 0);
  if (total > 0) {
    const evening = input.hourHistogram.slice(18).reduce((sum, value) => sum + value, 0) + input.hourHistogram.slice(0, 2).reduce((sum, value) => sum + value, 0);
    const share = evening / total;
    if (share >= 0.5) {
      const peak = input.hourHistogram.indexOf(Math.max(...input.hourHistogram));
      findings.push({
        headline: `${Math.round(share * 100)}% of all study happens after 6pm`,
        detail: `The school's busiest hour is ${peak}:00 on the students' own clocks. Anything timed to reach people — a broadcast, a homework deadline, a live revision session — is currently being sent into the quietest part of their day.`,
        tone: "neutral",
      });
    }
  }

  if (input.atRisk.length >= 3) {
    const silent = input.atRisk.filter((row) => (row.daysSinceSeen ?? 0) >= 14).length;
    findings.push({
      headline: `${input.atRisk.length} students are showing the pattern that precedes dropping out`,
      detail: `${silent} of them have not opened the portal in a fortnight. Being unseen for two weeks is the strongest single warning sign we can measure, and it shows up well before an unpaid invoice does.`,
      tone: "bad",
    });
  }

  const loud = input.cohorts
    .flatMap((cohort) => cohort.distinctive.map((row) => ({ cohort: cohort.group, ...row })))
    .filter((row) => row.lift >= 1.4)
    .sort((a, b) => b.lift - a.lift)[0];
  if (loud) {
    findings.push({
      headline: `${loud.cohort} uses ${loud.area} ${Math.round((loud.lift - 1) * 100)}% more than the rest of the school`,
      detail: `${loud.learners} learners in that level lean on it hard. Whatever is working there is worth copying into the levels that ignore it — and if the answer is one popular tutor, that is worth knowing too.`,
      tone: "good",
    });
  }

  const ignored = input.surfaces.filter((row) => row.learners > 0 && row.share < 0.01).slice(0, 1)[0];
  if (ignored && input.surfaces.length > 4) {
    findings.push({
      headline: `${ignored.area} is built and effectively unused`,
      detail: `${ignored.learners} students have opened it and it accounts for under 1% of time spent. Either it is not discoverable from where people actually are, or it does not answer a question anybody has.`,
      tone: "warn",
    });
  }

  // Only levels we can actually read. An unread level has cohesion 0 by
  // construction and would otherwise fill this finding with every cohort in
  // the school on the strength of no observations at all.
  const split = input.cohorts.filter((cohort) => cohort.measured >= 5 && cohort.cohesion < 0.3).map((cohort) => cohort.group);
  if (split.length) {
    findings.push({
      headline: `${split.join(", ")} ${split.length === 1 ? "is" : "are"} not really one group`,
      detail: "The learners in it behave in completely different ways from each other. A blanket announcement or a single deadline will suit some of them and actively fail the rest; these are the levels where targeting by behaviour pays off most.",
      tone: "neutral",
    });
  }

  return findings;
}
