import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { renderNotificationEmail } from "@/lib/notification-email";
import { batchFromAdmission } from "@/lib/batch";
import { resolveBatchStart, schoolDaysUntil } from "@/lib/batch-reservation";
import { readIntakeStartDayOverrides } from "@/lib/intake-server";
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

  const startDayOverrides = await readIntakeStartDayOverrides(null);
  const rows = await loadUpcomingBatchRows({ now, startDayOverrides });
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
    select: { id: true, createdAt: true, classesStartedAt: true, admission: true, level: true, user: { select: { name: true } } },
  });
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  for (const student of light) {
    if (student.classesStartedAt) continue;
    const start = resolveBatchStart(batchFromAdmission(student.admission), { registeredAt: student.createdAt, now, startDayOverrides, level: student.level });
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
  const startDayOverrides = await readIntakeStartDayOverrides(null);
  const rows = await loadUpcomingBatchRows({ now, startDayOverrides });
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

/* ---------------------------------------------------------------------------
 * The one-press "confirm your seat" send.
 *
 * The office presses ONE button on /admin/upcoming-intake and every learner in
 * that intake who has not finished paying gets the same warm message on every
 * channel they accept — bell, push and email. Nobody types anything.
 *
 * The framing is deliberate: the seat has been RESERVED for them, and paying is
 * how they CONFIRM it. Learners who have paid the deposit are told their seat
 * is confirmed and shown what is left. Learners paid in full are never in the
 * audience.
 *
 * Wording is a function of (seat status, amounts, intake), not of the person,
 * so learners are grouped by identical wording and each group is ONE notify()
 * call — a few calls for a whole intake instead of one per learner, which
 * matters over a slow database link. Their name arrives in the email greeting.
 * ------------------------------------------------------------------------ */

export type BlastSeat = "unpaid" | "registration_only" | "deposit_paid";

export function blastAudience(rows: SeatRow[], options: { includeDeposit?: boolean } = {}): SeatRow[] {
  const includeDeposit = options.includeDeposit ?? true;
  return rows.filter(
    (row) =>
      row.seat === "unpaid" ||
      row.seat === "registration_only" ||
      (includeDeposit && row.seat === "deposit_paid" && row.balanceOutstanding > 0),
  );
}

/** Learners whose seat is genuinely confirmed — the only honest "others have confirmed" number. */
export function confirmedCount(rows: SeatRow[]): number {
  return rows.filter((row) => row.seat === "deposit_paid" || row.seat === "paid_in_full").length;
}

export function confirmSeatMessage(row: SeatRow, confirmed: number): Draft {
  const month = row.batch;
  const opens = opensPhrase(row.startsOn);

  if (row.seat === "deposit_paid") {
    const message = `Becca here! Your ${month} seat is confirmed and classes open ${opens}. To complete your payment, clear the remaining ${naira(row.balanceOutstanding)} from your Payments page — it is due within your first month of classes.`;
    return {
      title: `Your ${month} seat is confirmed — finish your payment`,
      message,
      emailBody: `${message}\n\nThank you for holding your seat early. Your portal is a waiting room until ${opens} and opens on its own that morning.`,
    };
  }

  const owed = row.depositOutstanding > 0 ? row.depositOutstanding : row.requiredDeposit;
  const step =
    row.seat === "registration_only"
      ? `your registration is in, so pay the remaining ${naira(owed)} of your ${naira(row.requiredDeposit)} deposit from your Payments page`
      : `pay your ${naira(row.requiredDeposit)} deposit from your Payments page`;
  const others =
    confirmed > 0
      ? ` ${confirmed} ${confirmed === 1 ? "learner has" : "learners have"} already confirmed theirs.`
      : "";
  const message = `Becca here! A seat has been reserved for you in the ${month} intake, opening ${opens}. To confirm it, ${step}.${others}`;
  return {
    title: `Your ${month} seat is reserved — confirm it`,
    message,
    emailBody: `${message}\n\nYour portal is a waiting room until ${opens} and opens on its own that morning — for learners whose seat is confirmed. Tap the button below to confirm yours.`,
  };
}

export type SeatBlastResult = {
  /** Learners the message is for. */
  audience: number;
  bySeat: Record<BlastSeat, number>;
  /** Of those, who already had today's message — a double-click cannot double-send. */
  alreadySent: number;
  /** Learners who got a fresh bell row. */
  sent: number;
  pushed: number;
  emailed: number;
  /** One representative message per kind of seat, so the office sees exactly what goes out. */
  samples: { seat: BlastSeat; title: string; message: string }[];
};

function lagosDayKey(now: Date) {
  return now.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

/**
 * `rows` is the already-fenced list for ONE intake (the route scopes it to the
 * admin's tenant and branches); this only decides wording and sends.
 */
export async function sendSeatConfirmBlast(
  rows: SeatRow[],
  options: { now?: Date; includeDeposit?: boolean; dryRun?: boolean } = {},
): Promise<SeatBlastResult> {
  const now = options.now ?? new Date();
  const audience = blastAudience(rows, options);
  const confirmed = confirmedCount(rows);

  const result: SeatBlastResult = {
    audience: audience.length,
    bySeat: { unpaid: 0, registration_only: 0, deposit_paid: 0 },
    alreadySent: 0,
    sent: 0,
    pushed: 0,
    emailed: 0,
    samples: [],
  };
  if (audience.length === 0) return result;

  const dedupeKey = `seat-confirm:${audience[0].batchLabel}:${lagosDayKey(now)}`;

  const groups = new Map<string, { draft: Draft; studentIds: string[] }>();
  for (const row of audience) {
    const seat = row.seat as BlastSeat;
    result.bySeat[seat] += 1;
    const draft = confirmSeatMessage(row, confirmed);
    const key = `${draft.title}\u0000${draft.message}`;
    const group = groups.get(key) ?? { draft, studentIds: [] };
    group.studentIds.push(row.studentId);
    groups.set(key, group);
    if (!result.samples.some((sample) => sample.seat === seat)) {
      result.samples.push({ seat, title: draft.title, message: draft.message });
    }
  }

  const already = await prisma.notification.findMany({
    where: { studentId: { in: audience.map((row) => row.studentId) }, dedupeKey },
    select: { studentId: true },
  });
  result.alreadySent = new Set(already.map((n) => n.studentId)).size;
  if (options.dryRun) return result;

  for (const { draft, studentIds } of groups.values()) {
    const outcome = await notify({
      to: { studentIds },
      kind: KIND.tuitionReminder,
      severity: "info",
      title: draft.title,
      message: draft.message,
      emailBody: draft.emailBody,
      emailHtmlFor: ({ name }) =>
        renderNotificationEmail({
          name,
          title: draft.title,
          body: draft.emailBody,
          link: "/payments",
          identity: "support",
          cta: "Confirm my seat",
        }),
      link: "/payments",
      dedupeKey,
      push: true,
      email: true,
      // A whole-intake blast by text is real money; the office asked for email + push.
      sms: false,
    });
    result.sent += outcome.created;
    result.pushed += outcome.pushed;
    result.emailed += outcome.queuedEmails;
  }
  return result;
}
