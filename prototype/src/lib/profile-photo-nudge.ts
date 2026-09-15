import { prisma } from "@/lib/prisma";
import { notify, KIND } from "@/lib/notify";
import { hasProfilePhoto } from "@/lib/access";
import { receivedPaymentFilter, requiredDepositFor } from "@/lib/payment";

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
 * TWO COHORTS, TWO MESSAGES
 * ------------------------
 * - PAID + photo-less: the photo is literally the only thing between them and a
 *   working portal (the photo gate is independent of the paywall — see
 *   PhotoLockScreen). They get an urgent, lock-aware message and a shorter
 *   3-day cadence, because this is load-bearing, not cosmetic. The office was
 *   fielding "I paid and my portal is still locked" complaints from exactly
 *   this group.
 * - Everyone else photo-less: still stopped by the paywall, so the photo is not
 *   their blocker yet. They keep the original gentle once-a-week nudge.
 *
 * Both self-gate: idempotent per dedupe bucket, and a student drops out of the
 * query the moment they upload one.
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

/** 3-day buckets, UTC — the paid cohort's cadence. */
function threeDayKey(now = new Date()): string {
  const epochDays = Math.floor(now.getTime() / 86_400_000);
  return `d${Math.floor(epochDays / 3)}`;
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
    select: {
      id: true,
      userId: true,
      admission: true,
      level: true,
      classType: true,
      pathway: true,
      branch: { select: { name: true } },
      // Received tuition money only — `receivedPaymentFilter` excludes the
      // ₦5,000 registration fee, so it cannot push a student past the deposit.
      payments: { where: receivedPaymentFilter(), select: { amount: true } },
    },
  });

  const missing = students.filter((s) => s.userId && !hasProfilePhoto(s.admission));
  if (missing.length === 0) {
    return { scanned: students.length, missing: 0, paid: 0, unpaid: 0, created: 0 };
  }

  const paidIds: string[] = [];
  const unpaidIds: string[] = [];
  for (const s of missing) {
    const totalPaid = s.payments.reduce((sum, p) => sum + p.amount, 0);
    const deposit = requiredDepositFor({
      level: s.level,
      branch: s.branch?.name ?? null,
      classType: s.classType,
      pathway: s.pathway,
    });
    // deposit 0 (an unpriced pathway) counts as "past the gate" — a student
    // with nothing to pay is held only by the photo.
    (totalPaid >= deposit ? paidIds : unpaidIds).push(s.userId as string);
  }

  let created = 0;

  if (paidIds.length > 0) {
    const res = await notify({
      to: { userIds: paidIds },
      kind: KIND.profilePhotoMissing,
      severity: "warning",
      title: "One step to unlock your portal",
      message:
        "Becca here — your payment is in and your classes are ready. Your portal stays locked until there is a " +
        "photo on your profile; that is the only thing holding it. Open your profile page, tap the camera on your " +
        "photo, and take a selfie or upload one. Everything unlocks the moment it saves.",
      link: "/profile",
      push: true,
      dedupeKey: `profile-photo-paid:${threeDayKey()}`,
    });
    created += res.created;
  }

  if (unpaidIds.length > 0) {
    const res = await notify({
      to: { userIds: unpaidIds },
      kind: KIND.profilePhotoMissing,
      severity: "info",
      title: "Add a photo to your profile",
      message:
        "Becca here — your profile is still missing a photo. It puts a face to your name for your tutor and " +
        "classmates, and it is the one that goes on your certificate. It takes ten seconds from your profile page.",
      link: "/profile",
      push: true,
      dedupeKey: `profile-photo-missing:${isoWeekKey()}`,
    });
    created += res.created;
  }

  return {
    scanned: students.length,
    missing: missing.length,
    paid: paidIds.length,
    unpaid: unpaidIds.length,
    created,
  };
}
