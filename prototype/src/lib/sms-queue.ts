import { prisma } from "@/lib/prisma";
import { isSmsConfigured, sendSms } from "@/lib/sms";
import { runUnscoped } from "@/lib/tenant/context";

/**
 * The SMS pipeline — mirrors src/lib/email-queue.ts. Nothing is sent inline,
 * for the same reason: a bulk send to every unpaid student must return the
 * request immediately, and a Termii hiccup should cost a retry, not the
 * message.
 *
 * No suppression list here, unlike email: a wrong or dead phone number simply
 * fails to deliver (Termii reports it as an error on that one send) — it does
 * not get a sender blocklisted the way a bounced mailbox does, so there is
 * nothing to remember between sends.
 */

const BACKOFF_MINUTES = [1, 5, 30, 120];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

/** Same "small on purpose" reasoning as the email kick — see email-queue.ts. */
const KICK_LIMIT = 10;

async function kickSmsQueue(): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(async () => {
      try {
        await runUnscoped(
          "post-response SMS kick drains whatever is due across every tenant, like the nightly cron",
          () => drainSmsQueue(KICK_LIMIT),
        );
      } catch (error) {
        console.warn("sms queue: post-response drain failed", error);
      }
    });
  } catch {
    /* No request scope — the cron will get it. */
  }
}

export type QueueSmsInput = {
  to: string;
  message: string;
  type?: string;
  studentId?: string | null;
  scheduledFor?: Date;
  campaignId?: string;
};

export async function queueSms(input: QueueSmsInput) {
  const row = await prisma.smsMessage.create({
    data: {
      to: input.to,
      message: input.message,
      type: input.type ?? "general",
      studentId: input.studentId ?? null,
      campaignId: input.campaignId ?? null,
      scheduledFor: input.scheduledFor ?? new Date(),
    },
  });

  if (!input.scheduledFor || input.scheduledFor <= new Date()) {
    void kickSmsQueue();
  }

  return row;
}

export type DrainSmsResult = {
  processed: number;
  sent: number;
  failed: number;
  retrying: number;
  skipped: number;
};

/** Send everything that is due. Called by the cron; safe under concurrency — each row is claimed before it is sent. */
export async function drainSmsQueue(limit = 50): Promise<DrainSmsResult> {
  const result: DrainSmsResult = { processed: 0, sent: 0, failed: 0, retrying: 0, skipped: 0 };

  if (!isSmsConfigured()) {
    result.skipped = await prisma.smsMessage.count({
      where: { status: "queued", scheduledFor: { lte: new Date() } },
    });
    return result;
  }

  const due = await prisma.smsMessage.findMany({
    where: { status: "queued", scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });

  for (const message of due) {
    const claimed = await prisma.smsMessage.updateMany({
      where: { id: message.id, status: "queued" },
      data: { status: "sending" },
    });
    if (claimed.count === 0) continue;

    result.processed++;

    const outcome = await sendSms({ to: message.to, message: message.message });

    if (outcome.ok) {
      await prisma.smsMessage.update({
        where: { id: message.id },
        data: { status: "sent", sentAt: new Date(), attempts: { increment: 1 } },
      });
      result.sent++;
      continue;
    }

    const attempts = message.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await prisma.smsMessage.update({
        where: { id: message.id },
        data: { status: "failed", attempts, lastError: outcome.error ?? "Delivery failed" },
      });
      result.failed++;
    } else {
      const wait = BACKOFF_MINUTES[attempts - 1] ?? 60;
      await prisma.smsMessage.update({
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
