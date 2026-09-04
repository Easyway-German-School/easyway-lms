import { prisma } from "@/lib/prisma";
import { notify, KIND } from "@/lib/notify";
import { hasProfilePhoto } from "@/lib/access";

/**
 * "Your profile still has no photo — add one."
 *
 * The office was told to lean on students to upload a photo after their first
 * login, but plenty never get round to it and a faceless record helps nobody —
 * not the tutor taking a register, not the certificate with a blank avatar on
 * it. The admin form can now set a photo directly; this is the other half,
 * for everyone the office cannot chase one by one.
 *
 * A student's photo lives only in the `admission` JSON blob (`photoUrl`) —
 * there is no column — so the check is done in memory over the active roster
 * rather than as a JSON `where`, the same shape `recording-expiry-nudge` uses.
 *
 * GATING
 * ------
 * - Active students only, and only once their account is a few days old, so a
 *   student added this morning is not nagged before they have logged in.
 * - Deduped per ISO week (`dedupeKey`), so the daily tick nudges at most once a
 *   week per student, and stops entirely the moment they upload one — they
 *   drop out of the query.
 */

/** Don't nudge an account younger than this — give them a chance to do it themselves first. */
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

export async function nudgeStudentsWithoutPhoto() {
  const cutoff = new Date(Date.now() - MIN_ACCOUNT_AGE_DAYS * 86_400_000);

  const students = await prisma.student.findMany({
    where: {
      status: "active",
      user: { is: { role: "STUDENT", createdAt: { lt: cutoff } } },
    },
    orderBy: { createdAt: "asc" },
    take: SCAN_LIMIT,
    select: { id: true, userId: true, admission: true },
  });

  const targets = students.filter((s) => s.userId && !hasProfilePhoto(s.admission));
  if (targets.length === 0) {
    return { scanned: students.length, missing: 0, created: 0 };
  }

  const res = await notify({
    to: { userIds: targets.map((s) => s.userId as string) },
    kind: KIND.profilePhotoMissing,
    severity: "info",
    title: "Add a photo to your profile",
    message:
      "Becca here — your profile is still missing a photo. It puts a face to your name for your tutor and classmates, " +
      "and it is the one that goes on your certificate. It takes ten seconds from your profile page.",
    link: "/profile",
    push: true,
    dedupeKey: `profile-photo-missing:${isoWeekKey()}`,
  });

  return { scanned: students.length, missing: targets.length, created: res.created };
}
