import { prisma } from "@/lib/prisma";
import { notify, KIND } from "@/lib/notify";
import { assessProfileBackfill } from "@/lib/profile-backfill";

/**
 * "The office set you up by hand — I'm just missing a few bits."
 *
 * The other half of `branch-nudge` / `profile-photo-nudge`: a once-a-week
 * Becca nudge for students who came in off the public form (office-added or
 * imported) and still have gaps in the "important parts" of their admission
 * record — WhatsApp number, date of birth, where they live, a next-of-kin,
 * what they do, and why they're learning German. See src/lib/profile-backfill.ts
 * for what counts as a gap and when it's worth asking.
 *
 * GATING — the same shape as the other two nudges:
 * - Active students only, and only once the account is a few days old.
 * - Deduped per ISO week (`dedupeKey`), so the daily tick nudges at most once
 *   a week, and a student drops out the moment they finish (or "skip for now",
 *   which snoozes this for a fortnight — assessProfileBackfill checks it).
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

export async function nudgeStudentsWithProfileGaps() {
  const cutoff = new Date(Date.now() - MIN_ACCOUNT_AGE_DAYS * 86_400_000);

  const students = await prisma.student.findMany({
    where: {
      status: "active",
      user: { is: { role: "STUDENT", createdAt: { lt: cutoff } } },
    },
    orderBy: { createdAt: "asc" },
    take: SCAN_LIMIT,
    select: { id: true, userId: true, admission: true, profile: true },
  });

  const now = new Date();
  const targets = students.filter(
    (s) => s.userId && assessProfileBackfill(s.admission as Record<string, unknown> | null, s.profile, now).due,
  );
  if (targets.length === 0) {
    return { scanned: students.length, missing: 0, created: 0 };
  }

  const res = await notify({
    to: { userIds: targets.map((s) => s.userId as string) },
    kind: KIND.profileDetailsMissing,
    severity: "info",
    title: "Becca needs a few quick details",
    message:
      "Becca here — the office set your account up by hand, so a few things from the usual sign-up form are still " +
      "missing from your profile. It's six short questions, most already filled in for you, and you can skip any of " +
      "them. Two minutes from your profile page.",
    link: "/profile?setup=details",
    push: true,
    dedupeKey: `profile-details-missing:${isoWeekKey(now)}`,
  });

  return { scanned: students.length, missing: targets.length, created: res.created };
}
