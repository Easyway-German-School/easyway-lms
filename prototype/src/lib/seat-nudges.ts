import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { batchFromAdmission } from "@/lib/batch";
import { resolveBatchStart, schoolDaysUntil } from "@/lib/batch-reservation";
import { loadUpcomingBatchRows, type SeatRow } from "@/lib/batch-reservation-server";
import { getStudentAccess } from "@/lib/student-access";
import { studentIdsSilenced } from "@/lib/fee-reminder-settings";

/**
 * Becca's seat-reservation nudges.
 *
 * While a learner waits for their intake the portal is a waiting room, so the
 * only way to reach the ones who have not paid is OFF the portal — push and
 * email. This runs from the daily cron tick and speaks to three groups:
 *
 *   reserve    unpaid / registration-only learners: "your seat is not held yet"
 *              at 21, 14, 7, 3 and 1 days out. One message per milestone, each
 *              sent once ever (dedupeKey), so a learner who first appears at 12
 *              days gets the 14-day message and then the rest — never a burst.
 *   countdown  learners who HAVE paid: a "one week to go" and a "tomorrow" so
 *              the wait feels like anticipation, not silence.
 *   opening    everyone, on the day: the doors are open (paid) or classes have
 *              begun and the deposit gets them in (not paid).
 *
 * Real numbers only. "N learners have already secured theirs" is a straight
 * count of learners in the same intake who have paid something; when it is
 * zero the sentence is simply not said.
 *
 * SMS is forced OFF: this kind texts by default for tuition reminders, and a
 * five-message cadence across a whole intake is real money.
 */

export const RESERVE_TIERS = [1, 3, 7, 14, 21] as const;
export const COUNTDOWN_TIERS = [1, 7] as const;

/** The smallest milestone that today has reached, or null when it is still too early. */
export function tierFor(daysUntil: number, tiers: readonly number[]): number | null {
  const sorted = [...tiers].sort((a, b) => a - b);
  return sorted.find((tier) => daysUntil <= tier) ?? null;
}

function naira(value: number) {
  return `₦${Math.max(0, Math.round(value)).toLocaleString("en-NG")}`;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

function opensPhrase(startsOn: string) {
  return new Date(startsOn).toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Lagos",
  });
}

type Draft = { title: string; message: string; emailBody: string };

export function reserveMessage(row: SeatRow, daysUntil: number, secured: number): Draft {
  const month = row.batch;
  const owed = row.depositOutstanding > 0 ? row.depositOutstanding : row.requiredDeposit;
  const others =
    secured > 0
      ? `${secured} ${secured === 1 ? "learner has" : "learners have"} already secured theirs. `
      : "";
  const opens = opensPhrase(row.startsOn);
  const stage =
    row.seat === "registration_only"
      ? `Your registration is in, but your seat is not held yet — it is held once the ${naira(row.requiredDeposit)} deposit is paid (${naira(owed)} to go).`
      : `You are on the ${month} list, but nothing has been paid yet, so your seat is not held.`;

  const title =
    daysUntil <= 1
      ? `Tomorrow: ${month} classes begin`
      : daysUntil <= 3
        ? `${daysUntil} days left to reserve your ${month} seat`
        : daysUntil <= 7
          ? `One week to ${month} — hold your seat`
          : `Your ${month} seat is waiting`;

  const deposit = row.seat === "unpaid" ? `the ${naira(row.requiredDeposit)} deposit` : "the rest of the deposit";
  const closer =
    daysUntil <= 1
      ? `Pay ${deposit} today and you can walk in on day one.`
      : `Pay ${deposit} from your Payments page and the seat is yours.`;

  const message = `Becca here, ${firstName(row.name)}! ${stage} ${others}${closer}`;
  return {
    title,
    message,
    emailBody: `${message}\n\nClasses open ${opens}. Your portal is a waiting room until then, and it opens on its own the moment the day arrives — but only for learners whose seat is held.\n\nReserve your seat: open the EasyWay portal → Payments.`,
  };
}

export function countdownMessage(row: SeatRow, daysUntil: number): Draft {
  const month = row.batch;
  const seat = row.seatNumber ? ` (seat #${row.seatNumber})` : "";
  const balance =
    row.seat === "deposit_paid" && row.balanceOutstanding > 0
      ? ` The remaining ${naira(row.balanceOutstanding)} is due within your first month of classes.`
      : "";
  const title = daysUntil <= 1 ? `Tomorrow is the day, ${firstName(row.name)}` : `One week until ${month} classes`;
  const message =
    daysUntil <= 1
      ? `Becca here — your ${month} seat${seat} is held and your classroom opens tomorrow morning. Sign in and I will be waiting.`
      : `Becca here — your ${month} seat${seat} is held and classes open ${opensPhrase(row.startsOn)}. Add a profile photo now so opening day is instant.${balance}`;
  return { title, message, emailBody: message };
}

export function openingMessage(name: string, month: string, open: boolean): Draft {
  return open
    ? {
        title: `The doors are open, ${firstName(name)}!`,
        message: `Becca here — ${month} classes have begun and your classroom is open. Sign in and take your seat.`,
        emailBody: `Becca here — ${month} classes have begun and your classroom is open. Sign in to the EasyWay portal and take your seat.`,
      }
    : {
        title: `${month} classes have begun`,
        message: `Becca here — ${month} classes are under way. Pay your deposit from the Payments page and your classroom opens straight away.`,
        emailBody: `Becca here — ${month} classes are under way. Your classroom opens the moment your deposit is paid: open the EasyWay portal → Payments.`,
      };
}

export type SeatNudgeRun = {
  waiting: number;
  reserve: number;
  countdown: number;
  opening: number;
  skipped: number;
};

export async function runSeatNudges(
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<SeatNudgeRun> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const run: SeatNudgeRun = { waiting: 0, reserve: 0, countdown: 0, opening: 0, skipped: 0 };

  const rows = await loadUpcomingBatchRows({ now });
  run.waiting = rows.length;

  const securedByIntake = new Map<string, number>();
  for (const row of rows) {
    if (row.seat !== "unpaid") securedByIntake.set(row.batchLabel, (securedByIntake.get(row.batchLabel) ?? 0) + 1);
  }

  // The automatic run honours the Reminders-tab switch for bell / push / email.
  // The manual "nudge these learners" button below does not — it is a deliberate send.
  const silenced = await studentIdsSilenced("notifications", rows.map((row) => row.studentId));

  for (const row of rows) {
    if (silenced.has(row.studentId)) {
      run.skipped++;
      continue;
    }
    const daysUntil = schoolDaysUntil(new Date(row.startsOn), now);
    const needsPayment = row.seat === "unpaid" || row.seat === "registration_only";
    const tier = tierFor(daysUntil, needsPayment ? RESERVE_TIERS : COUNTDOWN_TIERS);
    if (tier === null) {
      run.skipped++;
      continue;
    }

    const draft = needsPayment
      ? reserveMessage(row, daysUntil, securedByIntake.get(row.batchLabel) ?? 0)
      : countdownMessage(row, daysUntil);
    const track = needsPayment ? "reserve" : "countdown";
    const dedupeKey = `seat-${track}:${row.batchLabel}:${tier}`;

    const already = await prisma.notification.findFirst({
      where: { studentId: row.studentId, dedupeKey },
      select: { id: true },
    });
    if (already) {
      run.skipped++;
      continue;
    }

    if (!dryRun) {
      await notify({
        to: { studentIds: [row.studentId] },
        kind: needsPayment ? KIND.tuitionReminder : KIND.announcement,
        severity: needsPayment && tier <= 3 ? "warning" : "info",
        title: draft.title,
        message: draft.message,
        emailBody: draft.emailBody,
        link: needsPayment ? "/payments" : "/notifications",
        dedupeKey,
        push: true,
        sms: false,
      });
    }
    run[track]++;
  }

  // ---- Opening day: batches that began within the last two days --------------
  const since = new Date(now.getTime());
  since.setMonth(since.getMonth() - 18);
  const light = await prisma.student.findMany({
    where: { status: "active", createdAt: { gte: since } },
    select: { id: true, createdAt: true, classesStartedAt: true, admission: true, user: { select: { name: true } } },
  });
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  for (const student of light) {
    if (student.classesStartedAt) continue;
    const start = resolveBatchStart(batchFromAdmission(student.admission), { registeredAt: student.createdAt, now });
    if (!start) continue;
    const age = now.getTime() - start.startsOn.getTime();
    if (age < 0 || age > TWO_DAYS) continue;

    const dedupeKey = `seat-opening:${start.monthLabel}`;
    const already = await prisma.notification.findFirst({ where: { studentId: student.id, dedupeKey }, select: { id: true } });
    if (already) {
      run.skipped++;
      continue;
    }
    const access = await getStudentAccess(student.id);
    const draft = openingMessage(student.user?.name ?? "", start.batch, access?.hasAccess ?? false);
    if (!dryRun) {
      await notify({
        to: { studentIds: [student.id] },
        kind: access?.hasAccess ? KIND.announcement : KIND.tuitionReminder,
        severity: "info",
        title: draft.title,
        message: draft.message,
        emailBody: draft.emailBody,
        link: access?.hasAccess ? "/dashboard" : "/payments",
        dedupeKey,
        push: true,
        sms: false,
      });
    }
    run.opening++;
  }

  return run;
}

/**
 * The office pressing "nudge" on specific learners. Same words as the cron,
 * but sent now — once per learner per day, so a double-click cannot double-send.
 */
export async function sendManualSeatNudges(
  studentIds: string[],
  options: { now?: Date } = {},
): Promise<{ sent: number; skipped: number }> {
  const now = options.now ?? new Date();
  const rows = await loadUpcomingBatchRows({ now });
  const securedByIntake = new Map<string, number>();
  for (const row of rows) {
    if (row.seat !== "unpaid") securedByIntake.set(row.batchLabel, (securedByIntake.get(row.batchLabel) ?? 0) + 1);
  }

  const wanted = new Set(studentIds);
  const dayKey = now.toISOString().slice(0, 10);
  let sent = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!wanted.has(row.studentId)) continue;
    const needsPayment = row.seat === "unpaid" || row.seat === "registration_only";
    if (!needsPayment) {
      skipped++;
      continue;
    }
    const daysUntil = schoolDaysUntil(new Date(row.startsOn), now);
    const draft = reserveMessage(row, daysUntil, securedByIntake.get(row.batchLabel) ?? 0);
    const dedupeKey = `seat-manual:${row.batchLabel}:${dayKey}`;
    const already = await prisma.notification.findFirst({ where: { studentId: row.studentId, dedupeKey }, select: { id: true } });
    if (already) {
      skipped++;
      continue;
    }
    await notify({
      to: { studentIds: [row.studentId] },
      kind: KIND.tuitionReminder,
      severity: "info",
      title: draft.title,
      message: draft.message,
      emailBody: draft.emailBody,
      link: "/payments",
      dedupeKey,
      push: true,
      sms: false,
    });
    sent++;
  }
  return { sent, skipped };
}
