import { prisma } from "@/lib/prisma";
import { notify, KIND } from "@/lib/notify";

/**
 * "Your profile has no branch yet — tell us where you are."
 *
 * A student with no `branchId` is invisible to almost everything that makes the
 * LMS work: the timetable generator has no cohort to place them in, the roster
 * and tutor pairing skip them, the community space is branch-scoped, and the
 * fee table is priced per branch. The office sets this on the Add-student form
 * and the importer fills it for online rows — this is the other half, for the
 * students who came in on a sheet with the column blank and can set it
 * themselves from their profile.
 *
 * GATING — the same shape as `profile-photo-nudge`:
 * - Active students only, and only once the account is a few days old, so a
 *   student added this morning is not nagged before they have logged in.
 * - Deduped per ISO week (`dedupeKey`), so the daily tick nudges at most once a
 *   week, and a student drops out of the query the moment they set a branch.
 */

/** Don't nudge an account younger than this — give them a chance to do it first. */
const MIN_ACCOUNT_AGE_DAYS = 3;
/** Ceiling on how many we look at per tick. A school has hundreds of students, not thousands. */
const SCAN_LIMIT = 800;

function isoWeekKey(now = new Date()): string {
  // ISO-8601 week number, UTC. Thursday of the current week decides the year.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-w${String(week).padStart(2, "0")}`;
}

export async function nudgeStudentsWithoutBranch() {
  const cutoff = new Date(Date.now() - MIN_ACCOUNT_AGE_DAYS * 86_400_000);

  const students = await prisma.student.findMany({
    where: {
      status: "active",
      branchId: null,
      user: { is: { role: "STUDENT", createdAt: { lt: cutoff } } },
    },
    orderBy: { createdAt: "asc" },
    take: SCAN_LIMIT,
    select: { id: true, userId: true },
  });

  const targets = students.filter((s) => s.userId);
  if (targets.length === 0) {
    return { scanned: students.length, missing: 0, created: 0 };
  }

  const res = await notify({
    to: { userIds: targets.map((s) => s.userId as string) },
    kind: KIND.profileBranchMissing,
    severity: "warning",
    title: "Set your branch to see your timetable",
    message:
      "Becca here — your profile is not linked to a branch yet, so your class timetable, tutor and study group " +
      "cannot be set up. It takes a moment from your profile page: pick your campus, or tell us you study online " +
      "and where in the world you are.",
    link: "/profile?setup=branch",
    push: true,
    dedupeKey: `profile-branch-missing:${isoWeekKey()}`,
  });

  return { scanned: students.length, missing: targets.length, created: res.created };
}
