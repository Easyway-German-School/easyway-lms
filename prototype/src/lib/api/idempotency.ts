import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api/response";

/**
 * Make a repeated write safe to repeat.
 *
 * The situation this exists for: a partner POSTs an enrolment, we create it,
 * and the response is lost to a timeout on the way back. The partner has no
 * way to know whether it worked. If retrying might enrol the student twice,
 * they cannot retry — and an API you cannot safely retry is one nobody builds
 * anything important on.
 *
 * So a write may carry `Idempotency-Key`, and a repeat of the same key returns
 * the first response verbatim instead of doing the work again.
 */

export function hashRequest(method: string, path: string, body: string): string {
  return crypto.createHash("sha256").update(`${method}:${path}:${body}`).digest("hex");
}

export type IdempotencyOutcome =
  | { status: "fresh"; key: string; requestHash: string }
  | { status: "replay"; response: Response }
  | { status: "conflict"; response: Response }
  | { status: "absent" };

/**
 * Decide what to do with an incoming write.
 *
 * Reusing a key with a *different* body is refused rather than replayed. It
 * always means a bug in the caller — usually a key generated once and reused
 * across a loop — and replaying the old answer would silently discard the new
 * request, which is the worst of the available behaviours: no error, no work
 * done, and a success response saying otherwise.
 */
export async function beginIdempotent(
  tenantId: string,
  headerKey: string | null,
  method: string,
  path: string,
  rawBody: string,
): Promise<IdempotencyOutcome> {
  if (!headerKey) return { status: "absent" };

  const requestHash = hashRequest(method, path, rawBody);
  const existing = await prisma.idempotencyRecord.findUnique({
    where: { tenantId_key: { tenantId, key: headerKey } },
    select: { requestHash: true, statusCode: true, responseBody: true },
  });

  if (!existing) return { status: "fresh", key: headerKey, requestHash };

  if (existing.requestHash !== requestHash) {
    return {
      status: "conflict",
      response: apiError(
        "idempotency_conflict",
        "This Idempotency-Key has already been used for a different request.",
      ),
    };
  }

  return {
    status: "replay",
    response: new Response(existing.responseBody, {
      status: existing.statusCode,
      headers: {
        "Content-Type": "application/json",
        // So the caller can tell a replay from fresh work — useful when they
        // are debugging their own retry logic.
        "Idempotent-Replay": "true",
      },
    }),
  };
}

/**
 * Store what we answered, so the next identical call can be given it again.
 *
 * Only successful responses are recorded. Storing a 500 would make a transient
 * failure permanent for that key: the partner retries exactly as they should,
 * and we hand back the same error forever without retrying anything.
 */
export async function completeIdempotent(
  tenantId: string,
  key: string,
  requestHash: string,
  statusCode: number,
  responseBody: string,
): Promise<void> {
  if (statusCode >= 500) return;

  try {
    await prisma.idempotencyRecord.create({
      data: { tenantId, key, requestHash, statusCode, responseBody },
    });
  } catch {
    /**
     * A unique-constraint violation here means two identical requests raced
     * and both did the work. The record already exists from the winner, which
     * is the outcome we wanted; nothing to repair.
     *
     * Worth being honest that this is a narrow window rather than a lock: a
     * true guarantee needs the write and the record in one transaction, which
     * means threading a transaction handle through every handler. Recorded as
     * a known limit rather than pretended away.
     */
  }
}

/**
 * Housekeeping. Keys are meaningless once no sane client would still retry.
 */
export async function pruneIdempotencyRecords(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const { count } = await prisma.idempotencyRecord.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
