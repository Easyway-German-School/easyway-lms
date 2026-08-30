import { prisma } from "@/lib/prisma";
import { notify, KIND } from "@/lib/notify";
import { canDownloadOffline } from "@/lib/delivery";

/**
 * "This class disappears in 2 days — download it in the app."
 *
 * The recording's video leaves a student's shelf 14 days after the class (see
 * src/lib/retention.ts). This finds the ones about to cross that line and tells
 * the students who can do something about it: the online, hybrid and private
 * students, who can install the app and keep an offline copy. A physical group
 * student has nothing to download and is left alone.
 *
 * Only students who have NOT finished the recording are nudged —
 * `VideoProgress.completed` is the best proxy the server has for "already got
 * what they needed from it". The copy is sharper for a student whose attendance
 * says they missed that class outright.
 *
 * Deduped per recording, so the daily tick never buzzes the same student twice
 * about the same tape.
 */

/** How far ahead of the cutoff to warn. */
const HORIZON_HOURS = 48;
/** Recordings inspected per tick — generous; there are rarely this many expiring in a day. */
const BATCH_LIMIT = 40;

export async function sendDueExpiryNudges() {
  const now = new Date();
  const soon = new Date(now.getTime() + HORIZON_HOURS * 3_600_000);

  const recordings = await prisma.classRecording.findMany({
    where: {
      status: "completed",
      keepForever: false,
      materialId: { not: null },
      studentExpiresAt: { gt: now, lte: soon },
    },
    orderBy: { studentExpiresAt: "asc" },
    take: BATCH_LIMIT,
    select: {
      id: true,
      level: true,
      sessionSlot: true,
      branchId: true,
      privateClassId: true,
      startedAt: true,
      studentExpiresAt: true,
      material: { select: { id: true, title: true } },
      privateClass: {
        select: {
          student: { select: { id: true, userId: true, deliveryMode: true, classType: true } },
        },
      },
    },
  });

  let considered = 0;
  let created = 0;

  for (const rec of recordings) {
    if (!rec.material || !rec.studentExpiresAt) continue;

    const daysLeft = Math.max(1, Math.ceil((rec.studentExpiresAt.getTime() - now.getTime()) / 86_400_000));
    const link = `/materials/watch/${rec.material.id}`;
    const dedupeKey = `recording-expiring:${rec.id}`;

    // Who can act on this.
    let roster: Array<{ id: string; userId: string }> = [];
    if (rec.privateClassId) {
      const s = rec.privateClass?.student;
      if (s?.userId && canDownloadOffline(s)) roster = [{ id: s.id, userId: s.userId }];
    } else if (rec.level) {
      const cohort = await prisma.student.findMany({
        where: {
          status: "active",
          level: rec.level,
          ...(rec.branchId ? { branchId: rec.branchId } : {}),
          ...(rec.sessionSlot ? { sessionSlot: rec.sessionSlot } : {}),
        },
        select: { id: true, userId: true, deliveryMode: true, classType: true },
      });
      roster = cohort
        .filter((s) => s.userId && canDownloadOffline(s))
        .map((s) => ({ id: s.id, userId: s.userId as string }));
    }
    if (roster.length === 0) continue;

    const studentIds = roster.map((s) => s.id);

    // Already finished it — treat as "has what they need".
    const finished = await prisma.videoProgress.findMany({
      where: { materialId: rec.material.id, completed: true, studentId: { in: studentIds } },
      select: { studentId: true },
    });
    const finishedSet = new Set(finished.map((f) => f.studentId));

    // Missed the class itself — attendance on the class date says absent.
    const classDay = new Date(rec.startedAt);
    const dayStart = new Date(classDay.getFullYear(), classDay.getMonth(), classDay.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const absences = await prisma.attendance.findMany({
      where: {
        studentId: { in: studentIds },
        date: { gte: dayStart, lt: dayEnd },
        OR: [{ present: false }, { status: "absent" }],
      },
      select: { studentId: true },
    });
    const missedSet = new Set(absences.map((a) => a.studentId));

    const eligible = roster.filter((s) => !finishedSet.has(s.id));
    if (eligible.length === 0) continue;

    // Split by copy so the "you missed this" version only reaches those it's true for.
    const missed = eligible.filter((s) => missedSet.has(s.id));
    const rest = eligible.filter((s) => !missedSet.has(s.id));
    const window = daysLeft === 1 ? "1 day" : `${daysLeft} days`;

    for (const [group, message] of [
      [
        missed,
        `You missed “${rec.material.title}” and the recording leaves your library in ${window}. Open it in the app and download it to catch up offline.`,
      ],
      [
        rest,
        `“${rec.material.title}” leaves your library in ${window}. Open it in the installed app and download it to keep it offline.`,
      ],
    ] as const) {
      if (group.length === 0) continue;
      considered += group.length;
      try {
        const res = await notify({
          to: { userIds: group.map((s) => s.userId) },
          kind: KIND.recordingExpiring,
          severity: "warning",
          title: "A class recording is about to disappear",
          message,
          link,
          push: true,
          dedupeKey,
        });
        created += res.created;
      } catch (error) {
        console.error("[recording-expiry-nudge] failed for", rec.id, error);
      }
    }
  }

  return { recordings: recordings.length, considered, created };
}
