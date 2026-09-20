import { describe, expect, it } from "vitest";
import {
  BreakerOpenError,
  BulkheadFullError,
  createBulkhead,
  createCircuitBreaker,
  retryWithBackoff,
  snapshotAll,
} from "./resilience";

const boom = () => Promise.reject(new Error("down"));
const ok = () => Promise.resolve("fine");
const catchError = async (p: Promise<unknown>) => p.then(() => null, (e) => e as Error);

describe("retryWithBackoff", () => {
  it("returns the first success without waiting", async () => {
    const waits: number[] = [];
    const result = await retryWithBackoff(async () => "yes", { sleep: async (ms) => void waits.push(ms) });
    expect(result).toBe("yes");
    expect(waits).toEqual([]);
  });

  it("retries a transient failure and then succeeds", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        if (++calls < 3) throw new Error("blip");
        return "recovered";
      },
      { sleep: async () => {}, random: () => 1 },
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("waits longer each time — exponential — up to the cap", async () => {
    const waits: number[] = [];
    await catchError(
      retryWithBackoff(boom, { retries: 4, baseMs: 100, factor: 2, maxMs: 500, random: () => 1, sleep: async (ms) => void waits.push(ms) }),
    );
    expect(waits).toEqual([100, 200, 400, 500]);
  });

  it("jitters: the wait is a random slice of the ceiling, so clients do not retry in lockstep", async () => {
    const waits: number[] = [];
    await catchError(retryWithBackoff(boom, { retries: 1, baseMs: 1000, random: () => 0.25, sleep: async (ms) => void waits.push(ms) }));
    expect(waits).toEqual([250]);
  });

  it("gives up after the retries and throws the LAST error", async () => {
    let calls = 0;
    const error = await catchError(
      retryWithBackoff(async () => { throw new Error(`fail ${++calls}`); }, { retries: 2, sleep: async () => {} }),
    );
    expect(calls).toBe(3);
    expect(error?.message).toBe("fail 3");
  });

  it("does not retry an error it was told is not safe to repeat", async () => {
    let calls = 0;
    await catchError(
      retryWithBackoff(async () => { calls++; throw new Error("card declined"); }, { shouldRetry: () => false, sleep: async () => {} }),
    );
    expect(calls).toBe(1);
  });
});

describe("createCircuitBreaker", () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, advance: (ms: number) => void (t += ms) };
  };

  it("stays closed and passes results through while things work", async () => {
    const b = createCircuitBreaker({ name: "t-ok" });
    expect(await b.run(ok)).toBe("fine");
    expect(b.state).toBe("closed");
  });

  it("opens after N consecutive failures and then fails FAST without calling the dependency", async () => {
    const c = clock();
    const b = createCircuitBreaker({ name: "t-open", failureThreshold: 3, now: c.now });
    for (let i = 0; i < 3; i++) await catchError(b.run(boom));
    expect(b.state).toBe("open");

    let called = false;
    const error = await catchError(b.run(async () => { called = true; return "x"; }));
    expect(error).toBeInstanceOf(BreakerOpenError);
    expect(called).toBe(false);
    expect(b.snapshot().rejected).toBe(1);
  });

  it("a success resets the count — only a RUN of failures trips it", async () => {
    const b = createCircuitBreaker({ name: "t-reset", failureThreshold: 3 });
    await catchError(b.run(boom));
    await catchError(b.run(boom));
    await b.run(ok);
    await catchError(b.run(boom));
    await catchError(b.run(boom));
    expect(b.state).toBe("closed");
  });

  it("goes half-open after the wait and closes again when the trial call succeeds", async () => {
    const c = clock();
    const b = createCircuitBreaker({ name: "t-recover", failureThreshold: 2, resetAfterMs: 1000, now: c.now });
    await catchError(b.run(boom));
    await catchError(b.run(boom));
    expect(b.state).toBe("open");

    c.advance(999);
    expect(b.state).toBe("open");
    c.advance(1);
    expect(b.state).toBe("half-open");

    expect(await b.run(ok)).toBe("fine");
    expect(b.state).toBe("closed");
    expect(b.snapshot().consecutiveFailures).toBe(0);
  });

  it("re-opens for another full wait if the trial call fails", async () => {
    const c = clock();
    const b = createCircuitBreaker({ name: "t-retrip", failureThreshold: 1, resetAfterMs: 1000, now: c.now });
    await catchError(b.run(boom));
    c.advance(1000);
    await catchError(b.run(boom)); // the probe fails
    expect(b.state).toBe("open");
    c.advance(500);
    expect(await catchError(b.run(ok))).toBeInstanceOf(BreakerOpenError);
  });

  it("lets exactly ONE probe through while half-open; the rest are still turned away", async () => {
    const c = clock();
    const b = createCircuitBreaker({ name: "t-probe", failureThreshold: 1, resetAfterMs: 1000, now: c.now });
    await catchError(b.run(boom));
    c.advance(1000);

    let release!: () => void;
    const probe = b.run(() => new Promise<string>((resolve) => { release = () => resolve("back"); }));
    const second = await catchError(b.run(ok));
    expect(second).toBeInstanceOf(BreakerOpenError);
    release();
    expect(await probe).toBe("back");
    expect(b.state).toBe("closed");
  });

  it("remembers the last error for the console", async () => {
    const b = createCircuitBreaker({ name: "t-last" });
    await catchError(b.run(() => Promise.reject(new Error("connection reset"))));
    expect(b.snapshot().lastError).toBe("connection reset");
  });
});

describe("createBulkhead", () => {
  const gate = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    return { promise, release };
  };

  it("runs up to maxConcurrent at once and queues the next", async () => {
    const b = createBulkhead({ name: "b-queue", maxConcurrent: 2, maxQueue: 5 });
    const g = gate();
    const running = [b.run(() => g.promise), b.run(() => g.promise), b.run(() => g.promise)];
    await Promise.resolve();
    expect(b.snapshot()).toMatchObject({ active: 2, queued: 1 });
    g.release();
    await Promise.all(running);
    expect(b.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });

  it("turns work away once both the slots and the queue are full", async () => {
    const b = createBulkhead({ name: "b-full", maxConcurrent: 1, maxQueue: 1 });
    const g = gate();
    const first = b.run(() => g.promise);
    const second = b.run(() => g.promise);
    const third = await catchError(b.run(ok));
    expect(third).toBeInstanceOf(BulkheadFullError);
    expect(b.snapshot().rejected).toBe(1);
    g.release();
    await Promise.all([first, second]);
  });

  it("releases the slot even when the work throws", async () => {
    const b = createBulkhead({ name: "b-throw", maxConcurrent: 1, maxQueue: 0 });
    await catchError(b.run(boom));
    expect(await b.run(ok)).toBe("fine");
    expect(b.snapshot().active).toBe(0);
  });

  it("hands a finished slot straight to the next waiter, in order", async () => {
    const b = createBulkhead({ name: "b-order", maxConcurrent: 1, maxQueue: 5 });
    const order: number[] = [];
    const g = gate();
    const a = b.run(async () => { await g.promise; order.push(1); });
    const c = b.run(async () => { order.push(2); });
    const d = b.run(async () => { order.push(3); });
    g.release();
    await Promise.all([a, c, d]);
    expect(order).toEqual([1, 2, 3]);
  });
});

describe("registry", () => {
  it("lists every breaker and bulkhead by name so the console can show them", () => {
    createCircuitBreaker({ name: "reg-breaker" });
    createBulkhead({ name: "reg-bulkhead" });
    const names = snapshotAll().map((s) => s.name);
    expect(names).toContain("reg-breaker");
    expect(names).toContain("reg-bulkhead");
    expect(names).toEqual([...names].sort());
  });
});

describe("withTimeout", () => {
  it("returns the result of work that finishes in time", async () => {
    const { withTimeout } = await import("./resilience");
    await expect(withTimeout(async () => "done", 1000, "quick")).resolves.toBe("done");
  });

  it("rejects with a TimeoutError naming the work when it takes too long", async () => {
    const { withTimeout, TimeoutError } = await import("./resilience");
    const error = (await withTimeout(() => new Promise(() => {}), 20, "stuck job").catch((e) => e)) as Error;
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error.message).toContain("stuck job");
  });

  it("passes the work's own error straight through", async () => {
    const { withTimeout } = await import("./resilience");
    await expect(withTimeout(() => Promise.reject(new Error("real failure")), 1000)).rejects.toThrow("real failure");
  });

  it("stops the wait, NOT the work: the abandoned job keeps running, and its later failure is swallowed", async () => {
    const { withTimeout } = await import("./resilience");
    let finished = false;
    let unhandled = false;
    const onUnhandled = () => (unhandled = true);
    process.on("unhandledRejection", onUnhandled);
    await withTimeout(
      () => new Promise<void>((_resolve, reject) => setTimeout(() => { finished = true; reject(new Error("late failure")); }, 60)),
      10,
      "slow",
    ).catch(() => {});
    expect(finished).toBe(false); // we already moved on
    await new Promise((r) => setTimeout(r, 120));
    expect(finished).toBe(true); // ...but it did keep working
    expect(unhandled).toBe(false); // ...and its failure did not crash anything
    process.off("unhandledRejection", onUnhandled);
  });
});
