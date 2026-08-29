import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/**
 * WHAT THE SCHOOL ACTUALLY DID, over a window.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS COMPUTED IN JS AND NOT IN SQL
 * ---------------------------------------------------------------------------
 * Every figure here is a count per DAY, and Prisma's `groupBy` cannot group on
 * a date truncation — you get one row per distinct timestamp, which for
 * timestamps is one row per record. The alternatives were raw SQL (three
 * queries the tenant extension does not scope, which is exactly the class of
 * mistake the isolation layer exists to prevent) or reading the window's rows
 * and bucketing them here. The window is bounded to 90 days and every query is
 * capped, so the row counts are in the low thousands at a school's real volume
 * — small enough that the honest, scoped version is also the fast enough one.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS AN ACTIVITY
 * ---------------------------------------------------------------------------
 * Four things, and they are deliberately not merged into one number:
 *
 *   LIVE CLASSES     a cohort session that was opened and taught
 *   PRIVATE CLASSES  a one-to-one session, which the school bills differently
 *   RECORDINGS       what LiveKit captured, including the ones that failed
 *   UPLOADS          material a human put into the library by hand
 *
 * The failures are reported rather than filtered out. "Was Tuesday recorded?"
 * is the question this page exists to answer, and a dashboard that only shows
 * successes answers it wrongly by omission.
 */

/** Longest window offered. Past this the row caps start truncating the truth. */
const MAX_DAYS = 90;

type DayBucket = {
  key: string;
  liveClasses: number;
  privateClasses: number;
  recordings: number;
  uploads: number;
};

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Minutes between two instants, floored at zero and capped at a sane class. */
function minutesBetween(from: Date, to: Date | null): number {
  if (!to) return 0;
  const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  // A session left open by a crashed browser is closed by the heartbeat
  // expiry, but a row that predates that can hold a twelve-hour "class". Six
  // hours is longer than any lesson this school runs, so anything beyond it is
  // a broken row rather than a long day, and averaging it in would make every
  // teaching-hours figure on the page a lie.
  return Math.max(0, Math.min(minutes, 360));
}

export async function GET(req: NextRequest) {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;

  try {
    const requested = Number(req.nextUrl.searchParams.get("days") ?? 30);
    const days = Math.max(7, Math.min(MAX_DAYS, Number.isFinite(requested) ? requested : 30));

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const [sessions, recordings, materials, totalMaterials, totalRecordings] = await Promise.all([
      prisma.liveClassSession.findMany({
        where: { startedAt: { gte: since } },
        orderBy: { startedAt: "desc" },
        take: 4000,
        select: {
          id: true,
          kind: true,
          title: true,
          level: true,
          startedAt: true,
          endedAt: true,
          branch: { select: { name: true } },
          lecturer: { select: { user: { select: { name: true } } } },
          _count: { select: { invites: true } },
        },
      }),
      prisma.classRecording.findMany({
        where: { startedAt: { gte: since } },
        orderBy: { startedAt: "desc" },
        take: 4000,
        select: {
          id: true,
          status: true,
          variant: true,
          level: true,
          startedAt: true,
          durationSeconds: true,
          sizeBytes: true,
          materialId: true,
        },
      }),
      prisma.material.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 4000,
        select: {
          id: true,
          title: true,
          kind: true,
          fileType: true,
          fileSize: true,
          level: true,
          createdAt: true,
          lecturer: { select: { user: { select: { name: true } } } },
        },
      }),
      prisma.material.count(),
      prisma.classRecording.count({ where: { status: "completed" } }),
    ]);

    /**
     * ATTENDANCE, counted from the invite rows the join path now writes.
     *
     * One query rather than pulling every invite: this is the only figure on
     * the page that could realistically run to tens of thousands of rows, and
     * nothing here needs to know WHICH students, only how many turned up.
     */
    const attendedJoins = sessions.length
      ? await prisma.liveClassInvite.count({
          where: { sessionId: { in: sessions.map((s) => s.id) }, status: "joined" },
        })
      : 0;

    // Every day in the window, including the empty ones. A chart that skips
    // quiet days compresses a fortnight of nothing into a flat line that reads
    // as steady activity.
    const buckets = new Map<string, DayBucket>();
    for (let index = 0; index < days; index += 1) {
      const date = new Date(since);
      date.setDate(since.getDate() + index);
      buckets.set(dayKey(date), {
        key: dayKey(date),
        liveClasses: 0,
        privateClasses: 0,
        recordings: 0,
        uploads: 0,
      });
    }

    let liveMinutes = 0;
    let privateMinutes = 0;
    let cohortCount = 0;
    let privateCount = 0;
    const byLevel = new Map<string, number>();

    for (const session of sessions) {
      const bucket = buckets.get(dayKey(session.startedAt));
      const minutes = minutesBetween(session.startedAt, session.endedAt);
      if (session.kind === "private") {
        privateCount += 1;
        privateMinutes += minutes;
        if (bucket) bucket.privateClasses += 1;
      } else {
        cohortCount += 1;
        liveMinutes += minutes;
        if (bucket) bucket.liveClasses += 1;
      }
      const level = session.level ?? "Unassigned";
      byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
    }

    let recordedSeconds = 0;
    let recordedBytes = 0;
    const recordingStatus: Record<string, number> = {};
    for (const recording of recordings) {
      const bucket = buckets.get(dayKey(recording.startedAt));
      if (bucket) bucket.recordings += 1;
      recordingStatus[recording.status] = (recordingStatus[recording.status] ?? 0) + 1;
      recordedSeconds += recording.durationSeconds ?? 0;
      recordedBytes += recording.sizeBytes ?? 0;
    }

    let uploadedBytes = 0;
    const uploadKinds: Record<string, number> = {};
    for (const material of materials) {
      const bucket = buckets.get(dayKey(material.createdAt));
      if (bucket) bucket.uploads += 1;
      uploadKinds[material.kind] = (uploadKinds[material.kind] ?? 0) + 1;
      uploadedBytes += material.fileSize ?? 0;
    }

    /**
     * The feed: the same events, interleaved and newest first.
     *
     * Built from the rows already in memory rather than a fifth query. It is
     * what makes the page readable as "what happened here today" rather than as
     * four independent statistics — and it is the part an admin actually scans.
     */
    const feed = [
      ...sessions.slice(0, 40).map((session) => ({
        at: session.startedAt,
        type: session.kind === "private" ? ("private" as const) : ("live" as const),
        title: session.title,
        detail: [
          session.lecturer?.user?.name,
          session.branch?.name,
          session.endedAt ? `${minutesBetween(session.startedAt, session.endedAt)} min` : "still running",
        ]
          .filter(Boolean)
          .join(" · "),
      })),
      ...recordings.slice(0, 40).map((recording) => ({
        at: recording.startedAt,
        type: "recording" as const,
        title: `${recording.variant === "audio" ? "Audio" : "Video"} capture`,
        detail: [
          recording.level,
          recording.status,
          recording.durationSeconds ? `${Math.round(recording.durationSeconds / 60)} min` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
      ...materials.slice(0, 40).map((material) => ({
        at: material.createdAt,
        type: "upload" as const,
        title: material.title,
        detail: [material.level, material.kind, material.lecturer?.user?.name]
          .filter(Boolean)
          .join(" · "),
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 40);

    return NextResponse.json({
      window: { days, since },
      totals: {
        liveClasses: cohortCount,
        privateClasses: privateCount,
        liveHours: Math.round((liveMinutes / 60) * 10) / 10,
        privateHours: Math.round((privateMinutes / 60) * 10) / 10,
        attendedJoins,
        recordings: recordings.length,
        recordedHours: Math.round((recordedSeconds / 3600) * 10) / 10,
        recordedGb: Math.round((recordedBytes / 1024 ** 3) * 100) / 100,
        uploads: materials.length,
        uploadedMb: Math.round(uploadedBytes / 1024 ** 2),
        /** All-time, for context under the windowed numbers. */
        libraryTotal: totalMaterials,
        recordingsEver: totalRecordings,
      },
      series: Array.from(buckets.values()),
      recordingStatus,
      uploadKinds,
      byLevel: Array.from(byLevel.entries())
        .map(([level, count]) => ({ level, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      feed,
    });
  } catch (error) {
    console.error("Materials activity failed", error);
    return NextResponse.json({ error: "Could not load activity" }, { status: 500 });
  }
}
