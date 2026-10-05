/**
 * A small in-process cache that also shares work already in flight.
 *
 * Built for the session callbacks in lib/auth.ts. Those run on every
 * `getServerSession` and every `/api/auth/session` — which, during a live
 * class, is every poll from every student. They ask the database things that
 * almost never change ("was this password reset?", "does this user still
 * exist?", "is this admin locked?"), and a page load fires a dozen requests at
 * once, so the same question was being asked a dozen times in the same second.
 *
 * Two behaviours:
 *   - a value is reused for `ttlMs`, per key;
 *   - while one caller is waiting on the database for a key, every other caller
 *     for that key waits on the same promise instead of starting its own.
 *
 * A FAILURE IS NEVER CACHED. If the loader throws, the entry is dropped and the
 * error goes to every waiter, so the callers' existing "fail open" handling
 * still sees the failure and the next request tries the database again.
 *
 * Per-instance memory, so it bounds the load rather than eliminating it: each
 * warm function asks once per key per window. Staleness is bounded by `ttlMs`.
 */

type Entry<T> = { at: number; value?: T; pending?: Promise<T> };

export type TtlCache<T> = {
  run(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
};

export function createTtlCache<T>(options: {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}): TtlCache<T> {
  const { ttlMs, maxEntries = 5_000 } = options;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry<T>>();

  return {
    run(key, load) {
      const t = now();
      const hit = entries.get(key);
      if (hit) {
        if (hit.pending) return hit.pending;
        if (t - hit.at < ttlMs) return Promise.resolve(hit.value as T);
      }

      // Bounded by sweeping rather than by LRU bookkeeping: this is a few
      // thousand small entries at most, and a full reset only costs one
      // database round trip per active user.
      if (entries.size >= maxEntries) entries.clear();

      const entry: Entry<T> = { at: t };
      const pending = load().then(
        (value) => {
          entry.value = value;
          entry.at = now();
          entry.pending = undefined;
          return value;
        },
        (error) => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        },
      );
      entry.pending = pending;
      entries.set(key, entry);
      return pending;
    },
    clear() {
      entries.clear();
    },
  };
}
