/**
 * THREE PATTERNS FOR A SYSTEM THAT SURVIVES REALITY.
 *
 * "Scalability isn't just about handling more traffic. It's about handling
 * failure gracefully." Every dependency this app leans on — the database, the
 * payment provider, the AI provider, the mail server — will at some point be
 * slow or down. What matters is what OUR code does next. Left alone it does the
 * worst possible thing: it keeps trying, every request waits for its own
 * timeout, threads and connections pile up behind the slow thing, and one sick
 * dependency takes the whole system down with it. That is a *cascading failure*.
 *
 * These three small tools stop the cascade. They are independent and they
 * compose: wrap a call in a bulkhead, then a breaker, then retry inside.
 *
 *   retryWithBackoff   — "it might work if we wait a moment"   (a TRANSIENT fault)
 *   createCircuitBreaker — "it is not going to work, stop asking" (a SUSTAINED fault)
 *   createBulkhead     — "this can only use its own share"     (a fault must not SPREAD)
 *
 * Where they are used in this app is listed in the developer console's
 * Patterns tab, with this instance's live state.
 *
 * Everything here takes its clock, sleeper and randomness as arguments so the
 * tests can run a thirty-second breaker timeout in a millisecond. That is not
 * over-engineering: time-dependent code you cannot fast-forward is code you
 * cannot test, and untested failure handling is the kind that fails.
 *
 * Pure TypeScript, no Node APIs — it runs in the edge runtime too.
 */

// ---------------------------------------------------------------------------
// 1. RETRY WITH BACKOFF
// ---------------------------------------------------------------------------

export type RetryOptions = {
  /** Retries AFTER the first attempt. 3 means up to 4 tries in all. */
  retries?: number;
  /** Delay before the first retry. */
  baseMs?: number;
  /** Each retry waits this many times longer than the last: 200, 400, 800 … */
  factor?: number;
  /** Never wait longer than this, however many retries. */
  maxMs?: number;
  /**
   * Which errors are worth retrying. Default: all. Be pickier than that for
   * anything that is not safe to repeat — see IDEMPOTENCY below.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests: returns [0,1). */
  random?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Try again after a growing wait, then give up and tell the truth.
 *
 * WHY BACKOFF (the wait grows). A service that is struggling is helped by fewer
 * requests, not by a stampede. If every client retried instantly, a blip would
 * become an outage, so each retry waits longer than the last (1s, 2s, 4s, 8s in
 * the slide; 200ms, 400ms, 800ms here).
 *
 * WHY JITTER (a random slice of that wait). If a thousand clients all failed at
 * the same instant they would also all retry at the same instant — a "thundering
 * herd", the very spike backoff was meant to avoid. Randomising each wait
 * spreads them out. This uses "full jitter": wait a random amount between 0 and
 * the backoff ceiling.
 *
 * IDEMPOTENCY — the warning on the slide. Retrying is only safe if doing the
 * thing twice is the same as doing it once. Reading a page: yes. "Charge the
 * card": NO, unless the operation carries an idempotency key the other side
 * de-duplicates on. Retrying a request that actually reached the server and
 * merely lost its reply is how customers get charged twice. Use `shouldRetry`
 * to retry only failures where you KNOW nothing happened (a connection that was
 * never opened) — which is exactly what prisma-cold-start-retry.ts does with
 * Prisma's P1001.
 */
export async function retryWithBackoff<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseMs = 200, factor = 2, maxMs = 5000, shouldRetry = () => true, sleep = realSleep, random = Math.random } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error, attempt)) break;
      const ceiling = Math.min(baseMs * factor ** attempt, maxMs);
      await sleep(Math.round(random() * ceiling));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// 2. CIRCUIT BREAKER
// ---------------------------------------------------------------------------

export type BreakerState = "closed" | "open" | "half-open";

export class BreakerOpenError extends Error {
  constructor(readonly breaker: string) {
    super(`Circuit "${breaker}" is open — failing fast instead of waiting on a dependency that keeps failing.`);
    this.name = "BreakerOpenError";
  }
}

export type BreakerOptions = {
  name: string;
  /** Consecutive failures that trip the breaker. */
  failureThreshold?: number;
  /** How long it stays open before allowing one trial call. */
  resetAfterMs?: number;
  /** Injected for tests. */
  now?: () => number;
};

export type BreakerSnapshot = {
  kind: "breaker";
  name: string;
  state: BreakerState;
  consecutiveFailures: number;
  /** Calls refused instantly because the circuit was open. */
  rejected: number;
  lastError: string | null;
  openedAt: number | null;
};

/**
 * Like the breaker in your house: when something is badly wrong, cut the circuit
 * so the fault cannot spread.
 *
 *   CLOSED ──(N failures in a row)──▶ OPEN ──(wait resetAfterMs)──▶ HALF-OPEN
 *      ▲                                                               │
 *      └──────────────(the one trial call succeeds)────────────────────┤
 *                       OPEN ◀──(the trial call fails)─────────────────┘
 *
 *  - CLOSED: everything flows normally. Failures are counted; one success resets
 *    the count (we want a *run* of failures, not scattered ones).
 *  - OPEN: calls do not even try. They fail INSTANTLY with BreakerOpenError.
 *    That is the whole point: a dependency that is timing out at 10 seconds a
 *    call would otherwise cost every request 10 seconds and a held connection.
 *    Failing in a microsecond keeps the rest of the app fast, and gives the
 *    struggling service silence to recover in.
 *  - HALF-OPEN: after the wait, let exactly ONE call through as a probe. If it
 *    works the dependency is back (CLOSED); if not, back to OPEN for another
 *    wait. Only one probe, so a recovering service is not flattened by the
 *    stampede of everything that was waiting.
 *
 * WHAT YOUR CODE MUST DO WITH BreakerOpenError. Decide up front what "the
 * dependency is down" means for this call: skip it (an optional notification),
 * serve something stale, or tell the user honestly. A breaker does not fix the
 * outage — it turns a slow, cascading failure into a fast, contained one that
 * you get to handle on purpose.
 *
 * State lives in this process. On a serverless platform each warm instance has
 * its own breaker, so each learns for itself; that is fine for protecting a
 * dependency, and the console labels the numbers as "this instance".
 */
export function createCircuitBreaker(options: BreakerOptions) {
  // `() => Date.now()`, not `Date.now`: the latter captures the clock function once, at
  // creation, so anything that later replaces the clock (fake timers in a test) is ignored.
  const { name, failureThreshold = 5, resetAfterMs = 30_000, now = () => Date.now() } = options;
  let state: BreakerState = "closed";
  let consecutiveFailures = 0;
  let openedAt: number | null = null;
  let probing = false;
  let rejected = 0;
  let lastError: string | null = null;

  const open = () => {
    state = "open";
    openedAt = now();
    probing = false;
  };

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (state === "open") {
      if (now() - (openedAt ?? 0) >= resetAfterMs) {
        state = "half-open";
        probing = false;
      } else {
        rejected++;
        throw new BreakerOpenError(name);
      }
    }
    if (state === "half-open") {
      // One probe at a time; everyone else is still turned away.
      if (probing) {
        rejected++;
        throw new BreakerOpenError(name);
      }
      probing = true;
    }

    try {
      const result = await fn();
      state = "closed";
      consecutiveFailures = 0;
      openedAt = null;
      probing = false;
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
      consecutiveFailures++;
      if (state === "half-open" || consecutiveFailures >= failureThreshold) open();
      throw error;
    }
  }

  const breaker = {
    name,
    run,
    /** The state, with the open→half-open transition applied lazily. */
    get state(): BreakerState {
      if (state === "open" && now() - (openedAt ?? 0) >= resetAfterMs) return "half-open";
      return state;
    },
    snapshot(): BreakerSnapshot {
      return { kind: "breaker", name, state: breaker.state, consecutiveFailures, rejected, lastError, openedAt };
    },
  };
  register(breaker);
  return breaker;
}

// ---------------------------------------------------------------------------
// 3. BULKHEAD
// ---------------------------------------------------------------------------

export class BulkheadFullError extends Error {
  constructor(readonly bulkhead: string) {
    super(`Bulkhead "${bulkhead}" is full — shedding this call rather than letting it queue without limit.`);
    this.name = "BulkheadFullError";
  }
}

export type BulkheadOptions = {
  name: string;
  /** How many calls may run at once. */
  maxConcurrent?: number;
  /** How many more may wait their turn. Beyond this, calls are turned away. */
  maxQueue?: number;
};

export type BulkheadSnapshot = {
  kind: "bulkhead";
  name: string;
  active: number;
  queued: number;
  maxConcurrent: number;
  maxQueue: number;
  /** Calls turned away because both the slots and the queue were full. */
  rejected: number;
};

/**
 * The watertight compartments in a ship's hull: if one floods, the ship floats.
 *
 * A bulkhead gives one kind of work its own fixed share of a scarce resource
 * (here: concurrent calls, which is to say database connections and time). The
 * slide's example is a payments pool that is OVERLOADED while the users pool and
 * notifications pool stay healthy. Without the wall, a flood of slow payment
 * calls would use every connection and starve everything, including logging in.
 *
 * Up to `maxConcurrent` calls run at once; up to `maxQueue` more wait; anything
 * beyond that is turned away immediately with BulkheadFullError. Turning work
 * away is a feature: an unbounded queue just converts overload into memory
 * growth and ever-longer waits, and the caller who waits 40 seconds has usually
 * already given up. Shed load early, on purpose.
 *
 * Breaker and bulkhead answer different questions. The breaker asks "is this
 * dependency broken?" The bulkhead asks "is this WORKLOAD using more than its
 * share?" — it protects everything else from a workload that is merely busy.
 */
export function createBulkhead(options: BulkheadOptions) {
  const { name, maxConcurrent = 4, maxQueue = 10 } = options;
  let active = 0;
  let rejected = 0;
  const waiting: Array<() => void> = [];

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      if (waiting.length >= maxQueue) {
        rejected++;
        throw new BulkheadFullError(name);
      }
      // Wait for a slot; whoever finishes hands theirs straight to us.
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active++;
    }
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next(); // the slot passes on without ever being freed
      else active--;
    }
  }

  const bulkhead = {
    name,
    run,
    snapshot(): BulkheadSnapshot {
      return { kind: "bulkhead", name, active, queued: waiting.length, maxConcurrent, maxQueue, rejected };
    },
  };
  register(bulkhead);
  return bulkhead;
}

// ---------------------------------------------------------------------------
// The registry — so the developer console can show them all
// ---------------------------------------------------------------------------

type Registered = { name: string; snapshot: () => BreakerSnapshot | BulkheadSnapshot };
const registry = new Map<string, Registered>();

function register(item: Registered) {
  registry.set(item.name, item);
}

/** Live state of every breaker and bulkhead in THIS process. */
export function snapshotAll(): Array<BreakerSnapshot | BulkheadSnapshot> {
  return [...registry.values()].map((item) => item.snapshot()).sort((a, b) => a.name.localeCompare(b.name));
}
