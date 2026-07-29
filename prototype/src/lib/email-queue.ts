import { prisma } from "@/lib/prisma";
import { sendEmail, isEmailConfigured } from "@/lib/mailer";
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

export type QueueInput = {
  to: string;
  subject: string;
  html: string;
  type?: string;
  studentId?: string | null;
  scheduledFor?: Date;
  campaignId?: string;
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

    const row = await queueEmail({ ...message, to, campaignId });
    if (row.status === "suppressed") suppressed++;
    else queued++;
  }

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
