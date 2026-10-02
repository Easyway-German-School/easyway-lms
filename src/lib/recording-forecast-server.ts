/**
 * Fetches the real schedule for the recording forecast (see recording-forecast.ts for why).
 *
 * Mirrors how `/api/admin/schedule` builds the admin calendar (cohort = branch + level + sitting, merged
 * timetable per cohort, private lessons), so the fleet plans for exactly what staff see on that page: tutor
 * moves, cancellations, closed days and one-off classes included.
 */

import { prisma } from "@/lib/prisma";
import { getMergedSchedule } from "@/lib/class-sessions";
import { sessionDurationMonths } from "@/lib/levels";
import {
  buildForecast,
  type ForecastGroupSession,
  type ForecastPrivateClass,
  type RecordingForecast,
} from "@/lib/recording-forecast";

const DAY = 24 * 3_600_000;
/** A room whose tutor has not been heard from for this long is treated as finished (matches live-presence). */
const LIVE_HEARTBEAT_MS = 3 * 60_000;

export async function loadRecordingForecast(opts: { tenantId: string; now?: Date; hours?: number }): Promise<RecordingForecast> {
  const now = opts.now ?? new Date();
  const hours = Math.min(Math.max(opts.hours ?? 48, 1), 168);
  const from = now;
  const to = new Date(now.getTime() + hours * 3_600_000);
  const branchFilter = { tenantId: opts.tenantId };

  // A "physical" student has no video lesson at all (see the Student.deliveryMode comment in the
  // schema) — only online/hybrid ever opens a LiveKit room, so only they can need a recorder.
  const needsVideo = { deliveryMode: { in: ["online", "hybrid"] } };

  const [students, privateClasses, liveNow] = await Promise.all([
    prisma.student.findMany({
      where: { status: "active", branch: branchFilter },
      select: { level: true, classType: true, deliveryMode: true, sessionSlot: true, createdAt: true, admission: true, branch: { select: { id: true } } },
    }),
    prisma.privateClass.findMany({
      where: { student: { status: "active", branch: branchFilter, ...needsVideo }, status: "scheduled", scheduledAt: { gte: new Date(from.getTime() - DAY), lte: to } },
      select: { scheduledAt: true, durationMinutes: true, status: true },
    }),
    prisma.liveClassSession.count({ where: { endedAt: null, lastSeenAt: { gte: new Date(now.getTime() - LIVE_HEARTBEAT_MS) } } }),
  ]);

  // One cohort per branch + level + sitting, exactly as the admin schedule page groups them. A cohort is
  // only forecast if AT LEAST ONE of its students actually attends over video — a cohort made up entirely
  // of physical students never opens a room, so a server held for it would record nothing.
  const cohorts = new Map<string, (typeof students)[number]>();
  const cohortsNeedingVideo = new Set<string>();
  for (const student of students) {
    if (student.classType !== "private" && student.branch) {
      const key = `${student.branch.id}:${student.level}:${student.sessionSlot ?? "evening"}`;
      if (!cohorts.has(key)) cohorts.set(key, student);
      const mode = String(student.deliveryMode ?? "physical").toLowerCase();
      if (mode === "online" || mode === "hybrid") cohortsNeedingVideo.add(key);
    }
  }
  for (const key of cohorts.keys()) {
    if (!cohortsNeedingVideo.has(key)) cohorts.delete(key);
  }

  const windowStart = from.getTime() - 2 * DAY;
  const windowEnd = to.getTime() + 2 * DAY; // slack: dates are stored at midnight, classes cross zones
  const groupSessions: ForecastGroupSession[] = [];
  await Promise.all(
    [...cohorts.entries()].map(async ([cohortKey, student]) => {
      const admission = student.admission && typeof student.admission === "object" && !Array.isArray(student.admission) ? (student.admission as Record<string, unknown>) : {};
      const schedule = await getMergedSchedule({
        branchId: student.branch!.id,
        level: student.level,
        batch: typeof admission.batch === "string" ? admission.batch : null,
        registeredAt: student.createdAt,
        sessionSlot: student.sessionSlot,
        now,
        months: sessionDurationMonths(student.sessionSlot),
      });
      for (const month of schedule.months) {
        for (const s of month.sessions) {
          const t = new Date(s.postponedTo ?? s.date).getTime();
          if (t < windowStart || t > windowEnd) continue; // keep the payload (and the maths) small
          groupSessions.push({ date: s.date, startTime: s.startTime, endTime: s.endTime, status: s.status, postponedTo: s.postponedTo, cohortKey });
        }
      }
    }),
  );

  const privates: ForecastPrivateClass[] = privateClasses;
  return {
    version: 1,
    generatedAt: now.toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    bucketMinutes: 15,
    buckets: buildForecast({ groupSessions, privateClasses: privates, from, to }),
    liveNow,
    cohorts: cohorts.size,
  };
}
