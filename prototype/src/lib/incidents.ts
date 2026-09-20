/**
 * The system's memory of what went wrong.
 *
 * Until this existed, an error was one `console.error` line in a Vercel log
 * nobody reads, and a complaint was a row in BetaFeedback nobody aggregates.
 * Neither could answer "is this new, how often, and did we already fix it?",
 * which is the question every self-correcting loop starts from.
 *
 * ONE ROW PER DISTINCT PROBLEM, not per occurrence. Two hundred students
 * hitting the same 500 is one Incident with occurrences = 200 — an
 * incident list you can read, and a count that says how bad it is. The
 * fingerprint is what decides "the same problem"; see `fingerprintOf`.
 *
 * REGRESSIONS ARE FIRST-CLASS. If an incident marked `resolved` happens again,
 * it reopens and `reopenedCount` goes up. A fix that did not hold is the most
 * valuable signal this table can give.
 *
 * NEVER THROWS. Recording an incident is a side effect of something already
 * going wrong; if this could itself fail the request, it would turn one error
 * into two. Every path here swallows its own failures into a console line.
 */

import { BreakerOpenError, BulkheadFullError, createBulkhead, createCircuitBreaker } from "@/lib/resilience";

export type IncidentKind = "error" | "complaint" | "drift" | "health";
export type IncidentSource = "request" | "cron" | "client" | "feedback" | "invariant";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export type IncidentInput = {
  kind: IncidentKind;
  source: IncidentSource;
  /** Where it happened, as a route pattern ("/api/student/access") or "cron:<job>". Never a raw URL. */
  route?: string | null;
  method?: string | null;
  message: string;
  stack?: string | null;
  severity?: IncidentSeverity;
  context?: Record<string, unknown>;
  tenantId?: string | null;
  userId?: string | null;
  feedbackId?: string | null;
};

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested; no I/O)
// ---------------------------------------------------------------------------

/**
 * Take the personal and secret parts out of text before it is stored.
 *
 * Error messages routinely embed whatever the failing query was given — an
 * email, a reset token, a connection string. The incident table is read by
 * more people than the request that produced the error ever was, so it must
 * not become a second copy of that data.
 */
export function scrub(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "[db-url]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]");
}

/**
 * Reduce a message to its shape so the same failure with a different id in it
 * lands on the same fingerprint. Ids, counts and quoted values vary per
 * request; the words around them do not.
 */
export function normaliseMessage(message: string): string {
  // Ids first: scrub()'s number pattern would otherwise eat the digit run inside
  // a record id and leave two ids looking different.
  const ids = message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\bc[a-z0-9]{24}\b/g, "<id>");
  return scrub(ids)
    .replace(/\s+/g, " ")
    .replace(/(["'`])(?:(?!\1).){1,80}\1/g, "$1?$1")
    .replace(/\b\d+\b/g, "#")
    .trim()
    .slice(0, 240);
}

/**
 * A 53-bit string hash (cyrb53). Not cryptographic and not meant to be: it only
 * has to keep distinct problems apart. It replaced `node:crypto` because this
 * file is reachable from `instrumentation.ts`, which Next also compiles for the
 * edge runtime — where a `node:` import is a build error in dev and a warning
 * that disables the hook in production. Pure JS has no such constraint.
 */
function hash53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function fingerprintOf(input: Pick<IncidentInput, "kind" | "route" | "message">): string {
  // Complaints are worded a hundred ways; what makes them "the same" is the page
  // they are about. Only fall back to wording when there is no page to go on.
  const byPage = input.kind === "complaint" && Boolean(input.route);
  const parts = [input.kind, (input.route ?? "").toLowerCase(), byPage ? "" : normaliseMessage(input.message)];
  const text = parts.join(" | ");
  // Two seeds: ~106 bits, so a collision between two real problems is not a concern.
  return hash53(text, 0).toString(16).padStart(14, "0") + hash53(text, 1).toString(16).padStart(14, "0");
}

/**
 * How loud an incident should be, before a human has looked at it.
 *
 * Money, auth, the access gate and live classes are the four places a fault
 * costs somebody something immediately — a student locked out, a payment
 * unrecorded, a class that will not start. Everything else defaults to medium.
 */
export function severityFor(input: Pick<IncidentInput, "kind" | "source" | "route">): IncidentSeverity {
  const route = (input.route ?? "").toLowerCase();
  if (input.kind === "drift") return "high";
  // One person's complaint is low however sensitive the page; it climbs by
  // occurrence count in the console, not by which route it happened to name.
  if (input.kind === "complaint") return "low";
  if (/paystack|monnify|flutterwave|payment|webhook|invoice/.test(route)) return "critical";
  if (/\/auth\/|\/api\/auth|\/student\/access|\/live|livekit|\/recording/.test(route)) return "high";
  return "medium";
}

function titleOf(input: IncidentInput): string {
  const firstLine = scrub(input.message).split("\n").find((line) => line.trim()) ?? "Unknown problem";
  const where = input.route ?? input.source;
  return `${where}: ${firstLine.trim().slice(0, 140)}`;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

const THROTTLE_MS = 30_000;
const MAX_TRACKED = 500;
const SAMPLE_LIMIT = 5;

/**
 * Per-isolate storm guard. If the database itself is down, every request errors
 * and every error would try to write here — a thousand writes a second into the
 * thing that is failing. The first sighting of a fingerprint writes; repeats
 * within the window only count, and the count is added on the next write.
 * Counts can be lost when an isolate is recycled, so occurrences is a floor,
 * not an exact figure. Complaints skip the throttle: each one is a person.
 */
const recent = new Map<string, { at: number; pending: number }>();

function shouldWrite(fingerprint: string, now: number): { write: boolean; extra: number } {
  const hit = recent.get(fingerprint);
  if (hit && now - hit.at < THROTTLE_MS) {
    hit.pending += 1;
    return { write: false, extra: 0 };
  }
  const extra = hit?.pending ?? 0;
  if (recent.size >= MAX_TRACKED) recent.clear();
  recent.set(fingerprint, { at: now, pending: 0 });
  return { write: true, extra };
}

/** Test seam. */
export function _resetThrottle() {
  recent.clear();
}

/**
 * The database half of recording an incident, kept separate so it can be wrapped
 * in the two protections below. Returns nothing; throws if the database fails.
 */
async function persistIncident(input: IncidentInput, fingerprint: string, message: string, now: number, extra: number): Promise<void> {
  const { guardedPrisma } = await import("@/lib/prisma");
  const at = new Date(now);
  const sample = {
    at: at.toISOString(),
    message: message.slice(0, 300),
    ...(input.context ? { context: input.context } : {}),
  };

  // A recurrence of something marked fixed is a regression — reopen it and say so.
  await guardedPrisma.incident.updateMany({
    where: { fingerprint, status: "resolved" },
    data: { status: "open", resolvedAt: null, reopenedCount: { increment: 1 } },
  });

  const existing = await guardedPrisma.incident.findUnique({
    where: { fingerprint },
    select: { id: true, samples: true },
  });

  if (existing) {
    const samples = [...(Array.isArray(existing.samples) ? existing.samples : []), sample].slice(-SAMPLE_LIMIT);
    await guardedPrisma.incident.update({
      where: { id: existing.id },
      data: {
        occurrences: { increment: 1 + extra },
        lastSeenAt: at,
        samples: samples as never,
      },
    });
    return;
  }

  try {
    await guardedPrisma.incident.create({
      data: {
        fingerprint,
        kind: input.kind,
        source: input.source,
        severity: input.severity ?? severityFor(input),
        title: titleOf({ ...input, message }),
        message,
        stack: input.stack ? scrub(input.stack).slice(0, 4000) : null,
        route: input.route ?? null,
        method: input.method ?? null,
        context: (input.context ?? undefined) as never,
        samples: [sample] as never,
        occurrences: 1 + extra,
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        feedbackId: input.feedbackId ?? null,
        firstSeenAt: at,
        lastSeenAt: at,
      },
    });
  } catch (error) {
    // Two isolates raced to create the same fingerprint; the loser just counts.
    if ((error as { code?: string })?.code === "P2002") {
      await guardedPrisma.incident.update({
        where: { fingerprint },
        data: { occurrences: { increment: 1 }, lastSeenAt: at },
      });
      return;
    }
    throw error;
  }
}

/**
 * OBSERVABILITY MUST NEVER TAKE DOWN THE THING IT OBSERVES.
 *
 * This code runs precisely when something has gone wrong — and the commonest
 * thing to go wrong is the database. So a failing database makes every request
 * error, every error tries to write an incident to that same failing database,
 * each write waits on a timeout, and the error handler piles load onto the
 * thing that is already down. That is a cascading failure with our own hands on
 * it. Two patterns from lib/resilience.ts stop it:
 *
 *  - BULKHEAD: at most a couple of incident writes in flight at once, a short
 *    queue behind them, everything else dropped. The recorder gets its own small
 *    share of database connections and can never use more, no matter how many
 *    errors are happening — so it cannot starve the requests that are trying to
 *    serve students.
 *  - CIRCUIT BREAKER: after a run of failed writes, stop trying for a while. A
 *    write that fails instantly costs nothing; one that waits out a timeout
 *    costs a held connection every time. The first write after the pause is a
 *    probe; if it works, recording resumes by itself.
 *
 * Dropping an incident here is the right call, not a loss: the error is already
 * in the platform log (captureError writes that first), and complaints are
 * already durable in BetaFeedback. The incident register is a convenience layer
 * and is allowed to be briefly blind. Being unable to see is survivable; being
 * unable to serve is not.
 */
const writeBulkhead = createBulkhead({ name: "incident-writes", maxConcurrent: 2, maxQueue: 20 });
const writeBreaker = createCircuitBreaker({ name: "incident-db", failureThreshold: 4, resetAfterMs: 30_000 });

let lastShedLog = 0;
function noteShed(error: Error) {
  // A storm of dropped writes must not become a storm of log lines.
  const now = Date.now();
  if (now - lastShedLog > 60_000) {
    lastShedLog = now;
    console.warn(`[incidents] recording paused (${error.name}); errors are still in the platform log`);
  }
}

export async function recordIncident(input: IncidentInput): Promise<void> {
  try {
    // Edge runtime has no Prisma; the log line captureError already wrote is all it gets.
    if (process.env.NEXT_RUNTIME === "edge") return;

    const message = scrub(input.message).slice(0, 1500);
    // From the RAW message: fingerprintOf normalises ids before it scrubs. Feeding
    // it already-scrubbed text lets scrub() mangle the digits inside ids first,
    // and the same failure with a different id becomes a different incident.
    const fingerprint = fingerprintOf(input);
    const now = Date.now();

    let extra = 0;
    if (input.kind !== "complaint") {
      const gate = shouldWrite(fingerprint, now);
      if (!gate.write) return;
      extra = gate.extra;
    }

    try {
      // Bulkhead outside, breaker inside: a full compartment turns work away
      // before it ever counts against the dependency's health.
      await writeBulkhead.run(() => writeBreaker.run(() => persistIncident(input, fingerprint, message, now, extra)));
    } catch (error) {
      if (error instanceof BreakerOpenError || error instanceof BulkheadFullError) return noteShed(error);
      throw error;
    }
  } catch (error) {
    console.error("[incidents] could not record incident:", error instanceof Error ? error.message : error);
  }
}

/**
 * A person telling us something is wrong. Complaints about the same page fold
 * into one incident, so "five students say the live page is broken" is one
 * row with five occurrences instead of five rows to read.
 */
export async function recordComplaint(input: {
  feedbackId: string;
  kind: string;
  path?: string | null;
  message: string;
  userId?: string | null;
  tenantId?: string | null;
}): Promise<void> {
  // "/live/abc123" and "/live/xyz789" are the same page to a complainer.
  const route = input.path
    ? input.path.split("?")[0].replace(/\/[0-9a-z]{20,}(?=\/|$)/gi, "/:id").slice(0, 120)
    : null;
  await recordIncident({
    kind: "complaint",
    source: "feedback",
    route,
    message: `${input.kind}: ${input.message}`,
    feedbackId: input.feedbackId,
    userId: input.userId,
    tenantId: input.tenantId,
    context: { feedbackKind: input.kind },
  });
}
