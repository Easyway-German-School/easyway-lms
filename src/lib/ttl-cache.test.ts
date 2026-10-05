import { describe, expect, it, vi } from "vitest";

import { createTtlCache } from "./ttl-cache";

describe("createTtlCache", () => {
  it("reuses a value inside the window and reloads after it", async () => {
    let clock = 0;
    const cache = createTtlCache<number>({ ttlMs: 1_000, now: () => clock });
    const load = vi.fn(async () => ++clock);

    expect(await cache.run("u1", load)).toBe(1);
    clock = 500;
    expect(await cache.run("u1", load)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);

    clock = 1_500;
    expect(await cache.run("u1", load)).toBe(1_501);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps keys apart", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1_000 });
    expect(await cache.run("a", async () => "A")).toBe("A");
    expect(await cache.run("b", async () => "B")).toBe("B");
  });

  it("a dozen simultaneous callers cost one load", async () => {
    const cache = createTtlCache<number>({ ttlMs: 1_000 });
    let release!: (n: number) => void;
    const load = vi.fn(() => new Promise<number>((resolve) => (release = resolve)));

    const callers = Array.from({ length: 12 }, () => cache.run("u1", load));
    release(7);

    expect(await Promise.all(callers)).toEqual(Array(12).fill(7));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never caches a failure: every waiter sees it, the next call retries", async () => {
    const cache = createTtlCache<number>({ ttlMs: 1_000 });
    let fail!: (e: Error) => void;
    const first = vi.fn(() => new Promise<number>((_resolve, reject) => (fail = reject)));

    const a = cache.run("u1", first);
    const b = cache.run("u1", first);
    fail(new Error("db down"));
    await expect(a).rejects.toThrow("db down");
    await expect(b).rejects.toThrow("db down");

    expect(await cache.run("u1", async () => 42)).toBe(42);
  });

  it("caches a falsy answer too (a reset that never happened is still an answer)", async () => {
    const cache = createTtlCache<null>({ ttlMs: 1_000 });
    const load = vi.fn(async () => null);
    await cache.run("u1", load);
    await cache.run("u1", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("stays bounded", async () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, maxEntries: 3 });
    const load = vi.fn(async () => 1);
    for (const key of ["a", "b", "c", "d"]) await cache.run(key, load);
    await cache.run("d", load); // still cached after the reset
    expect(load).toHaveBeenCalledTimes(4);
  });
});
