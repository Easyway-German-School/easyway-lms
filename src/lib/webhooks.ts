import crypto from "node:crypto";
import { guardedPrisma } from "@/lib/prisma";
import { currentTenantId } from "@/lib/tenant/context";

/**
 * Telling a partner's system that something happened, without them polling us
 * for it.
 *
 * The design decisions here are all about the same thing: a webhook receiver
 * you do not control is going to be down, slow, or wrong, and none of those may
 * become our problem.
 *
 *  - **Queued, never sent inline.** A partner's endpoint hanging for thirty
 *    seconds must not hang the enrolment that triggered it. The event is
 *    written and a worker delivers it.
 *  - **Signed, with a timestamp.** A receiver that cannot verify the message
 *    came from us has to trust anybody who finds the URL, and one without a
 *    timestamp can have yesterday's "payment received" replayed at it forever.
 *  - **Retried, then given up on.** Retrying into a dead URL for eternity is
 *    how a queue becomes the outage.
 */

export type WebhookEvent =
  | "student.enrolled"
  | "student.updated"
  | "payment.recorded"
  | "attendance.recorded"
  | "class.scheduled"
  | "credit.low";

/**
 * Exponential, in minutes, and it stops.
 *
 * Roughly seventeen hours across six attempts — long enough to ride out a
 * deploy or an overnight outage at the partner's end, short enough that a
 * genuinely dead endpoint is not still being hit next week.
 */
const BACKOFF_MINUTES = [1, 5, 15, 60, 360, 720];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

/** Past this many consecutive failures the endpoint is switched off. */
const DISABLE_AFTER = 20;

export function signPayload(secret: string, timestamp: number, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Queue an event for every endpoint of the current tenant that wants it.
 *
 * Never throws. A webhook that cannot be queued must not fail the thing that
 * produced it — the student is still enrolled, the payment still landed, and
 * the partner finding out late is a smaller problem than the enrolment failing.
 */
export async function emitWebhook(
  event: WebhookEvent,
  payload: Record<string, unknown>,
  options: { tenantId?: string } = {},
): Promise<{ queued: number }> {
  try {
    const tenantId = options.tenantId ?? currentTenantId();
    if (!tenantId) return { queued: 0 };

    const endpoints = await guardedPrisma.webhookEndpoint.findMany({
      where: { tenantId, disabledAt: null },
      select: { id: true, events: true },
    });

    const wanted = endpoints.filter((endpoint) => {
      const events = endpoint.events.trim();
      if (events === "*" || events === "") return events === "*";
      return events.split(",").map((e) => e.trim()).includes(event);
    });

    if (wanted.length === 0) return { queued: 0 };

    await guardedPrisma.webhookDelivery.createMany({
      data: wanted.map((endpoint) => ({
        endpointId: endpoint.id,
        tenantId,
        event,
        payload: payload as never,
        status: "pending",
        nextAttemptAt: new Date(),
      })),
    });

    return { queued: wanted.length };
  } catch (error) {
    console.warn("[webhooks] could not queue", event, error);
    return { queued: 0 };
  }
}

/**
 * Deliver what is due. Called by the cron dispatcher.
 *
 * Spans every tenant by design, so it runs under the dispatcher's unscoped
 * declaration and uses the guarded client directly.
 */
export async function deliverPendingWebhooks(
  limit = 25,
): Promise<{ attempted: number; delivered: number; failed: number; disabled: number }> {
  const due = await guardedPrisma.webhookDelivery.findMany({
    where: {
      status: "pending",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: {
      endpoint: { select: { id: true, url: true, secret: true, failureCount: true, disabledAt: true } },
    },
  });

  let delivered = 0;
  let failed = 0;
  let disabled = 0;

  for (const item of due) {
    if (!item.endpoint || item.endpoint.disabledAt) {
      await guardedPrisma.webhookDelivery.update({
        where: { id: item.id },
        data: { status: "failed", lastError: "Endpoint is disabled." },
      });
      failed += 1;
      continue;
    }

    const body = JSON.stringify({
      id: item.id,
      event: item.event,
      createdAt: item.createdAt.toISOString(),
      data: item.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(item.endpoint.secret, timestamp, body);

    const attempts = item.attempts + 1;
    let status = 0;
    let error: string | null = null;

    try {
      /**
       * Ten seconds, and no redirects followed.
       *
       * A receiver that redirects is a receiver whose real destination we did
       * not agree to send a signed payload to — an open redirect on their side
       * would become a way to have us POST a school's data anywhere.
       */
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(item.endpoint.url, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Easyway-Event": item.event,
          "X-Easyway-Timestamp": String(timestamp),
          "X-Easyway-Signature": `sha256=${signature}`,
          "X-Easyway-Delivery": item.id,
        },
        body,
      });
      clearTimeout(timer);
      status = response.status;
      if (status < 200 || status >= 300) error = `Endpoint answered ${status}.`;
    } catch (e) {
      error = e instanceof Error ? e.message : "Delivery failed.";
    }

    if (!error) {
      delivered += 1;
      await guardedPrisma.$transaction([
        guardedPrisma.webhookDelivery.update({
          where: { id: item.id },
          data: {
            status: "delivered",
            attempts,
            lastStatus: status,
            lastError: null,
            deliveredAt: new Date(),
            nextAttemptAt: null,
          },
        }),
        // Reset on success: the counter measures a CURRENT outage, not the
        // endpoint's history. An endpoint that failed nineteen times last year
        // and works today should not be one bad afternoon from being switched
        // off.
        guardedPrisma.webhookEndpoint.update({
          where: { id: item.endpoint.id },
          data: { failureCount: 0 },
        }),
      ]);
      continue;
    }

    failed += 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    const backoff = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)];

    await guardedPrisma.webhookDelivery.update({
      where: { id: item.id },
      data: {
        status: exhausted ? "failed" : "pending",
        attempts,
        lastStatus: status || null,
        lastError: error.slice(0, 500),
        nextAttemptAt: exhausted ? null : new Date(Date.now() + backoff * 60_000),
      },
    });

    const failureCount = item.endpoint.failureCount + 1;
    const shouldDisable = failureCount >= DISABLE_AFTER;
    if (shouldDisable) disabled += 1;

    await guardedPrisma.webhookEndpoint.update({
      where: { id: item.endpoint.id },
      data: {
        failureCount,
        ...(shouldDisable ? { disabledAt: new Date() } : {}),
      },
    });
  }

  return { attempted: due.length, delivered, failed, disabled };
}

/**
 * Housekeeping. A delivered webhook is a receipt, not a record worth keeping
 * forever, and the table would otherwise grow without limit.
 */
export async function pruneWebhookDeliveries(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await guardedPrisma.webhookDelivery.deleteMany({
    where: { status: { in: ["delivered", "failed"] }, createdAt: { lt: cutoff } },
  });
  return count;
}
