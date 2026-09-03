import { prisma } from "@/lib/prisma";
import { sendEmail, isEmailConfigured } from "@/lib/mailer";
import { isMailIdentityKey, type MailIdentityKey } from "@/lib/mail-identity";
import { runUnscoped } from "@/lib/tenant/context";
import crypto from "crypto";

/**
 * The email pipeline.
 *
 * Nothing is sent inline. Queueing means a bulk send to every unpaid student
 * returns immediately instead of holding a request open for minutes, and a
 * provider hiccup costs a retry rather than the message.
 *
 * Three rules the queue enforces that a bare sendEmail() cannot:
 *
 *   Suppression  a bounced, complained or unsubscribed address is never
 *                written to again, whatever asks for it.
 *   Backoff      failures retry on a widening delay, then stop. Hammering a
 *                provider that is rejecting you is how a sender gets blocked.
 *   Idempotency  a campaign will not queue the same address twice.
 */

/** Attempt N waits this many minutes before being retried. */
const BACKOFF_MINUTES = [1, 5, 30, 120];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

/**
 * How many a single post-response kick will send.
 *
 * Small on purpose. This runs after the response on the SAME serverless
 * invocation, against a function timeout — so it exists to get the message
 * that was just queued out of the door, not to clear a backlog. The nightly
 * cron still drains in bulk, and anything this misses is simply picked up by
 * the next kick or the next cron.
 */
const KICK_LIMIT = 10;

/**
 * Send what was just queued, right after the response goes out.
 *
 * WHY THIS EXISTS. `queueEmail` writes a row and nothing else; the only thing
 * that ever sent it was `/api/cron/tick`, which vercel.json runs at 06:00
 * daily. So a tutor announcing "no class today, we move to 4pm" got the bell
 * and the push instantly and the EMAIL the following morning — a notification
 * arriving after the event it describes. Everything else about the queue was
 * right; it just had no prompt dispatcher.
 *
 * `after()` is the fix rather than a more frequent cron because it works on
 * every Vercel plan. Sub-daily crons need Pro, and a vercel.json the plan
 * rejects fails the deploy — so the cheap-looking config change is the one
 * that could take the site down.
 *
 * Deliberately fire-and-forget and deliberately swallowing:
 *
 *   - `after` throws outside a request scope. Scripts, the cron route itself
 *     and the test suite all call queueEmail perfectly legitimately, and none
 *     of them should fail because a convenience could not be scheduled.
 *   - A send failure inside the kick must not surface. The row is already
 *     safely queued with backoff and retry; the kick is an optimisation, and
 *     an optimisation may not fail the thing it was optimising.
 */
async function kickQueue(): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(async () => {
      try {
        /**
         * UNSCOPED, exactly like the cron dispatcher that also calls
         * `drainQueue`. `EmailMessage` is a tenant-owned table, so a query on
         * it throws under strict isolation unless a tenant OR an unscoped scope
         * is in context — and an `after()` callback runs after the response,
         * outside the request's async context, so the tenant scope the request
         * set is already gone by the time this fires. Without this wrapper the
         * drain threw `TenantIsolationError`, the catch below swallowed it, and
         * the just-queued message sat until the 06:00 cron — the day-long delay
         * this kick exists to remove, quietly back.
         */
        await runUnscoped(
          "post-response email kick drains whatever is due across every tenant, like the nightly cron",
          () => drainQueue(KICK_LIMIT),
        );
      } catch (error) {
        console.warn("email queue: post-response drain failed", error);
      }
    });
  } catch {
    /* No request scope — the cron will get it. */
  }
}

export type QueueInput = {
  to: string;
  subject: string;
  html: string;
  type?: string;
  studentId?: string | null;
  scheduledFor?: Date;
  campaignId?: string;
  /** "support" or "noreply". See src/lib/mail-identity.ts. */
  identity?: MailIdentityKey;
};

/** Signed token so an unsubscribe link cannot be forged for someone else. */
export function unsubscribeToken(email: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? "easyway-dev-secret";
  return crypto.createHmac("sha256", secret).update(email.toLowerCase()).digest("hex").slice(0, 32);
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = unsubscribeToken(email);
  // Constant-time compare; both are fixed-length hex so lengths always match.
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token.padEnd(expected.length).slice(0, expected.length)));
}

export function unsubscribeUrl(email: string): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubscribeToken(email)}`;
}

/** Appends the unsubscribe footer that keeps bulk mail out of spam folders. */
export function withUnsubscribeFooter(html: string, email: string): string {
  return `${html}
    <hr style="margin:32px 0 16px;border:none;border-top:1px solid #e2e8f0" />
    <p style="font-size:12px;color:#64748b;line-height:1.6">
      You are receiving this because you are registered with Easyway German Language School.
      <a href="${unsubscribeUrl(email)}" style="color:#64748b">Unsubscribe from non-essential email</a>.
    </p>`;
}

export async function isSuppressed(email: string): Promise<boolean> {
  const hit = await prisma.emailSuppression.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });
  return Boolean(hit);
}

/** Queue one message. Suppressed addresses are recorded, not silently dropped. */
export async function queueEmail(input: QueueInput) {
  const row = await writeQueueRow(input);

  /**
   * The kick lives HERE rather than at the eight call sites that queue mail,
   * so a future one cannot forget it and quietly reintroduce the day-long
   * delay. Not awaited: it schedules work for after the response and must add
   * nothing to the latency of the request that queued the message.
   *
   * Scheduled-for-later mail is left to the cron — kicking the queue for
   * something not yet due would just claim it and put it straight back.
   */
  if (!input.scheduledFor || input.scheduledFor <= new Date()) {
    void kickQueue();
  }

  return row;
}

/**
 * The write on its own, with no kick.
 *
 * Split out for `queueCampaign`, which queues in a loop: routing that through
 * `queueEmail` would schedule one post-response drain PER RECIPIENT, so a
 * two-hundred student announcement would register two hundred callbacks that
 * each try to claim the same ten rows. It queues once and kicks once instead.
 */
async function writeQueueRow(input: QueueInput) {
  const to = input.to.trim().toLowerCase();

  if (await isSuppressed(to)) {
    return prisma.emailMessage.create({
      data: {
        to,
        subject: input.subject,
        html: input.html,
        type: input.type ?? "general",
        studentId: input.studentId ?? null,
        campaignId: input.campaignId ?? null,
        identity: input.identity ?? "noreply",
        status: "suppressed",
        lastError: "Address is on the suppression list",
      },
    });
  }

  return prisma.emailMessage.create({
    data: {
      to,
      subject: input.subject,
      html: input.html,
      type: input.type ?? "general",
      studentId: input.studentId ?? null,
      campaignId: input.campaignId ?? null,
      identity: input.identity ?? "noreply",
      scheduledFor: input.scheduledFor ?? new Date(),
    },
  });
}

/** Queue many at once, skipping addresses already queued for this campaign. */
export async function queueCampaign(messages: QueueInput[], campaignId: string) {
  const existing = await prisma.emailMessage.findMany({
    where: { campaignId },
    select: { to: true },
  });
  const already = new Set(existing.map((m) => m.to));

  let queued = 0, suppressed = 0, duplicate = 0;

  for (const message of messages) {
    const to = message.to.trim().toLowerCase();
    if (already.has(to)) { duplicate++; continue; }
    already.add(to);

    const row = await writeQueueRow({ ...message, to, campaignId });
    if (row.status === "suppressed") suppressed++;
    else queued++;
  }

  // Once for the whole campaign, not once per recipient.
  if (queued > 0) void kickQueue();

  return { campaignId, queued, suppressed, duplicate, total: messages.length };
}

export type DrainResult = {
  processed: number;
  sent: number;
  failed: number;
  retrying: number;
  skipped: number;
};

/**
 * Send everything that is due. Called by a cron route; safe to run
 * concurrently because each message is claimed before it is sent.
 */
export async function drainQueue(limit = 50): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, sent: 0, failed: 0, retrying: 0, skipped: 0 };

  if (!isEmailConfigured()) {
    result.skipped = await prisma.emailMessage.count({
      where: { status: "queued", scheduledFor: { lte: new Date() } },
    });
    return result;
  }

  const due = await prisma.emailMessage.findMany({
    where: { status: "queued", scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });

  for (const message of due) {
    // Claim it first: two workers running at once must not both send.
    const claimed = await prisma.emailMessage.updateMany({
      where: { id: message.id, status: "queued" },
      data: { status: "sending" },
    });
    if (claimed.count === 0) continue;

    result.processed++;

    // The address may have been suppressed after this was queued.
    if (await isSuppressed(message.to)) {
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "suppressed", lastError: "Suppressed before delivery" },
      });
      result.skipped++;
      continue;
    }

    const outcome = await sendEmail({
      to: message.to,
      subject: message.subject,
      html: message.html,
      type: message.type,
      studentId: message.studentId,
      // Read off the row, not off the environment. A message queued as
      // "support" must still go out as support even if the default changed
      // while it sat in the queue behind a backoff.
      identity: isMailIdentityKey(message.identity) ? message.identity : undefined,
    });

    if (outcome.ok) {
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "sent", sentAt: new Date(), attempts: { increment: 1 } },
      });
      result.sent++;
      continue;
    }

    const attempts = message.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "failed", attempts, lastError: outcome.error ?? "Delivery failed" },
      });
      result.failed++;
    } else {
      const wait = BACKOFF_MINUTES[attempts - 1] ?? 60;
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: "queued",
          attempts,
          lastError: outcome.error ?? "Delivery failed",
          scheduledFor: new Date(Date.now() + wait * 60_000),
        },
      });
      result.retrying++;
    }
  }

  return result;
}

export async function suppress(email: string, reason: string, note?: string) {
  const normalized = email.trim().toLowerCase();
  await prisma.emailSuppression.upsert({
    where: { email: normalized },
    update: { reason, note: note ?? null },
    create: { email: normalized, reason, note: note ?? null },
  });

  // Anything already queued to this address should never go out.
  await prisma.emailMessage.updateMany({
    where: { to: normalized, status: "queued" },
    data: { status: "suppressed", lastError: `Suppressed: ${reason}` },
  });
}
