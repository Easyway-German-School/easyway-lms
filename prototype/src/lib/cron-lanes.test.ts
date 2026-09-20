import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRON_PLAN, TICK_BUDGET_MS, runTick, type TickPlan } from "./cron-lanes";
import { TimeoutError } from "./resilience";

type Work = () => Promise<unknown>;
const jobsOf = (entries: Array<[string, Work]>) => new Map<string, Work>(entries);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
};

const plan = (lanes: TickPlan["lanes"], prelude: string[] = []): TickPlan => ({ prelude, preludeBudgetMs: 5000, lanes });
const lane = (name: string, jobs: string[], extra: Partial<TickPlan["lanes"][number]> = {}) => ({
  name,
  budgetMs: 10_000,
  jobBudgetMs: 5_000,
  jobs,
  ...extra,
});

describe("runTick", () => {
  it("runs the prelude alone and to completion BEFORE any lane starts", async () => {
    const log: string[] = [];
    const jobs = jobsOf([
      ["sweep", async () => { log.push("sweep:start"); await sleep(20); log.push("sweep:end"); }],
      ["a1", async () => void log.push("a1")],
      ["b1", async () => void log.push("b1")],
    ]);
    await runTick({ jobs, plan: plan([lane("A", ["a1"]), lane("B", ["b1"])], ["sweep"]) });
    expect(log.slice(0, 2)).toEqual(["sweep:start", "sweep:end"]);
    expect(log).toHaveLength(4);
  });

  it("runs lanes at the same time: a lane that is stuck does not hold up another", async () => {
    const stuck = gate();
    const done: string[] = [];
    const jobs = jobsOf([
      ["slow", async () => { await stuck.promise; done.push("slow"); }],
      ["fast", async () => void done.push("fast")],
    ]);
    const tick = runTick({ jobs, plan: plan([lane("A", ["slow"]), lane("B", ["fast"])]) });
    await sleep(30);
    expect(done).toEqual(["fast"]); // B finished while A is still blocked
    stuck.open();
    const { results } = await tick;
    expect(results.map((r) => r.ok)).toEqual([true, true]);
  });

  it("keeps jobs inside a lane in their declared order", async () => {
    const order: string[] = [];
    const mk = (n: string) => async () => { await sleep(n === "one" ? 20 : 1); order.push(n); };
    const jobs = jobsOf([["one", mk("one")], ["two", mk("two")], ["three", mk("three")]]);
    await runTick({ jobs, plan: plan([lane("A", ["one", "two", "three"])]) });
    expect(order).toEqual(["one", "two", "three"]); // "one" is slowest yet still first
  });

  it("returns results in the order the jobs were declared, not the order they finished", async () => {
    const jobs = jobsOf([
      ["declared-first", async () => { await sleep(40); return 1; }],
      ["declared-second", async () => 2],
    ]);
    const { results } = await runTick({ jobs, plan: plan([lane("A", ["declared-first"]), lane("B", ["declared-second"])]) });
    expect(results.map((r) => r.job)).toEqual(["declared-first", "declared-second"]);
  });

  it("a failing job is reported and does not stop the jobs after it", async () => {
    const onError = vi.fn();
    const jobs = jobsOf([
      ["boom", async () => { throw new Error("kaput"); }],
      ["after", async () => "still ran"],
    ]);
    const { results, lanes } = await runTick({ jobs, plan: plan([lane("A", ["boom", "after"])]), onError });
    expect(results[0]).toMatchObject({ job: "boom", ok: false, status: "failed", error: "kaput" });
    expect(results[1]).toMatchObject({ job: "after", ok: true, detail: "still ran" });
    expect(onError).toHaveBeenCalledWith("boom", expect.any(Error));
    expect(lanes.find((l) => l.name === "A")).toMatchObject({ failed: 1, ran: 2 });
  });

  it("survives an error sink that itself throws", async () => {
    const jobs = jobsOf([["boom", async () => { throw new Error("x"); }], ["after", async () => "ok"]]);
    const { results } = await runTick({ jobs, plan: plan([lane("A", ["boom", "after"])]), onError: () => { throw new Error("sink down"); } });
    expect(results.map((r) => r.status)).toEqual(["failed", "ok"]);
  });

  it("reports a job that is not in the plan's registry rather than crashing", async () => {
    const { results } = await runTick({ jobs: jobsOf([]), plan: plan([lane("A", ["ghost"])]) });
    expect(results[0]).toMatchObject({ job: "ghost", ok: false, status: "failed" });
  });

  it("runs a job missing from the plan in a fallback lane instead of dropping it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ran: string[] = [];
    const jobs = jobsOf([["planned", async () => void ran.push("planned")], ["orphan", async () => void ran.push("orphan")]]);
    const { results, lanes } = await runTick({ jobs, plan: plan([lane("A", ["planned"])]) });
    expect(ran.sort()).toEqual(["orphan", "planned"]);
    expect(lanes.map((l) => l.name)).toContain("unassigned");
    expect(results.find((r) => r.job === "orphan")?.lane).toBe("unassigned");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("with `only`, runs the prelude and that one lane and nothing else", async () => {
    const ran: string[] = [];
    const mk = (n: string) => async () => void ran.push(n);
    const jobs = jobsOf([["sweep", mk("sweep")], ["a1", mk("a1")], ["b1", mk("b1")]]);
    await runTick({ jobs, plan: plan([lane("A", ["a1"]), lane("B", ["b1"])], ["sweep"]), only: "B" });
    expect(ran.sort()).toEqual(["b1", "sweep"]);
  });
});

describe("time budgets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T06:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("abandons a job that hangs at its cap, reports it as timed out, and runs the next job", async () => {
    const onError = vi.fn();
    const jobs = jobsOf([
      ["hangs", () => new Promise(() => {})],
      ["next", async () => "fine"],
    ]);
    const tick = runTick({ jobs, plan: plan([lane("A", ["hangs", "next"], { jobBudgetMs: 3000 })]), onError });
    await vi.advanceTimersByTimeAsync(3100);
    const { results, lanes } = await tick;
    expect(results[0]).toMatchObject({ job: "hangs", status: "timed_out", ok: false });
    expect(results[0].error).toContain("hangs");
    expect(results[1]).toMatchObject({ job: "next", ok: true });
    expect(onError).toHaveBeenCalledWith("hangs", expect.any(TimeoutError));
    expect(lanes.find((l) => l.name === "A")).toMatchObject({ timedOut: 1 });
  });

  it("gives one job a smaller cap than its neighbours when told to", async () => {
    const jobs = jobsOf([["webhooks", () => new Promise(() => {})], ["other", () => new Promise(() => {})]]);
    const tick = runTick({ jobs, plan: plan([lane("A", ["webhooks", "other"], { jobBudgetMs: 4000, caps: { webhooks: 1500 } })]) });
    await vi.advanceTimersByTimeAsync(1600);
    await vi.advanceTimersByTimeAsync(4100);
    const { results } = await tick;
    expect(results[0].ms).toBeLessThan(2000);
    expect(results[1].ms).toBeGreaterThanOrEqual(4000);
  });

  it("SKIPS what is left once a lane's budget is spent, rather than overrunning", async () => {
    const ran: string[] = [];
    const jobs = jobsOf([
      ["uses-most", async () => { await sleep(2600); ran.push("uses-most"); }],
      ["no-time-left", async () => void ran.push("no-time-left")],
    ]);
    const tick = runTick({ jobs, plan: plan([lane("A", ["uses-most", "no-time-left"], { budgetMs: 3000, jobBudgetMs: 3000 })]) });
    await vi.advanceTimersByTimeAsync(2700);
    const { results, lanes } = await tick;
    expect(ran).toEqual(["uses-most"]);
    expect(results[1]).toMatchObject({ status: "skipped", ok: false });
    expect(lanes.find((l) => l.name === "A")).toMatchObject({ skipped: 1 });
  });

  it("never lets a lane outlive the whole tick's budget", async () => {
    const jobs = jobsOf([["forever", () => new Promise(() => {})]]);
    const tick = runTick({ jobs, plan: plan([lane("A", ["forever"], { budgetMs: 100_000, jobBudgetMs: 100_000 })]), budgetMs: 4000 });
    await vi.advanceTimersByTimeAsync(4100);
    const { results } = await tick;
    expect(results[0]).toMatchObject({ status: "timed_out" });
    expect(results[0].ms).toBeLessThanOrEqual(4100);
  });
});

describe("the real CRON_PLAN", () => {
  const routeSource = readFileSync(join(process.cwd(), "src/app/api/cron/tick/route.ts"), "utf8");
  const registered = [...routeSource.matchAll(/^\s*register\("([a-z-]+)"/gm)].map((m) => m[1]);
  const planned = [...CRON_PLAN.prelude, ...CRON_PLAN.lanes.flatMap((l) => l.jobs)];

  it("schedules every job the route registers — a new job cannot silently go unscheduled", () => {
    expect(registered.length).toBeGreaterThan(30);
    expect(registered.filter((name) => !planned.includes(name))).toEqual([]);
  });

  it("names no job the route does not register — a removed job cannot leave a ghost in the plan", () => {
    expect(planned.filter((name) => !registered.includes(name))).toEqual([]);
  });

  it("puts each job in exactly one place", () => {
    expect(new Set(planned).size).toBe(planned.length);
  });

  it("keeps the orderings the old sequential tick depended on", () => {
    const laneOf = (job: string) => CRON_PLAN.lanes.find((l) => l.jobs.includes(job));
    const before = (lane: string, a: string, b: string) => {
      const jobs = CRON_PLAN.lanes.find((l) => l.name === lane)!.jobs;
      return jobs.indexOf(a) >= 0 && jobs.indexOf(a) < jobs.indexOf(b);
    };
    // payment plans are swept before anything reads who is locked out
    expect(CRON_PLAN.prelude).toEqual(["payment-plans"]);
    // metering is read before it is rolled up, and the roll-up before the balance warning
    expect(before("housekeeping", "meter-storage", "usage-rollup")).toBe(true);
    expect(before("housekeeping", "meter-active-students", "usage-rollup")).toBe(true);
    expect(before("housekeeping", "usage-rollup", "low-balance-warnings")).toBe(true);
    // a recording is reconciled before it is transcribed
    expect(before("media", "recording-reconcile", "class-transcription")).toBe(true);
    // the payment reminders come after the plans that decide who is behind — the prelude guarantees it
    expect(laneOf("payment-warnings")?.name).toBe("delivery");
  });

  it("fits inside the function's 300s: the prelude plus the longest lane, with slack", () => {
    const longest = Math.max(...CRON_PLAN.lanes.map((l) => l.budgetMs));
    expect(CRON_PLAN.preludeBudgetMs + longest).toBeLessThanOrEqual(TICK_BUDGET_MS);
    expect(TICK_BUDGET_MS).toBeLessThan(300_000);
  });

  it("never lets a single job's cap exceed its lane's budget", () => {
    for (const l of CRON_PLAN.lanes) {
      expect(l.jobBudgetMs).toBeLessThanOrEqual(l.budgetMs);
      for (const cap of Object.values(l.caps ?? {})) expect(cap).toBeLessThanOrEqual(l.budgetMs);
      for (const capped of Object.keys(l.caps ?? {})) expect(l.jobs).toContain(capped);
    }
  });
});
