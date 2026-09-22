import { Prisma } from "@prisma/client";

import { parsePriceBook, PRICE_BOOK_KEY, setActivePriceBook } from "@/lib/price-book";

/**
 * KEEPING THE ACTIVE PRICE BOOK FRESH ON THE SERVER.
 *
 * `tuitionFeeFor` and friends are synchronous and called from ~40 places, so
 * they cannot await a database read themselves. Instead the book is loaded
 * ahead of them, by a Prisma extension (below) that runs in front of EVERY
 * query in the app: if the last load is older than TTL_MS it re-reads the one
 * `pricing.book` row first. A fee is always computed from data that was itself
 * read from the database — a student, a charge, a payment — so by the time any
 * fee lookup runs, the query that fetched its inputs has already made sure the
 * book is current. No call site has to remember anything, which matters: the
 * routes that forget things are the ones written in a hurry.
 *
 * Freshness: an admin's save updates the instance that handled it at once;
 * every other serverless instance picks it up within TTL_MS (15s) — that is the
 * "live, no deploy" promise. The cost is one tiny indexed read per instance per
 * 15s, and only ever piggy-backed on a real query, so it never wakes a
 * suspended Neon compute by itself.
 *
 * FAILURE IS QUIET: if the read fails the last good book stays in force (or the
 * built-in defaults on a cold instance) and the next attempt is delayed a few
 * seconds. The extension NEVER throws — a price lookup failing must not turn
 * into a failed student request.
 */

const TTL_MS = 15_000;
const RETRY_AFTER_FAILURE_MS = 5_000;

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || "easyway";

type State = { loadedAt: number; retryAt: number; inflight: Promise<void> | null };

// On `globalThis` for the same reason the active book is — see price-book.ts.
const STATE = Symbol.for("easyway.priceBook.refreshState");
type Holder = { [STATE]?: State };
const holder = globalThis as unknown as Holder;

function state(): State {
  return (holder[STATE] ??= { loadedAt: 0, retryAt: 0, inflight: null });
}

/**
 * The one method the refresher needs. A structural type rather than
 * PrismaClient so the extension can hand in the client it is built on without
 * dragging the whole generated client type through.
 */
export type PriceBookReader = {
  schoolSetting: {
    findFirst: (args: {
      where: { key: string; tenantRef: { slug: string } };
      select: { value: true };
    }) => PromiseLike<{ value: unknown } | null>;
  };
};

export function priceBookIsFresh(now: number = Date.now()): boolean {
  const s = state();
  return now - s.loadedAt < TTL_MS || now < s.retryAt;
}

/** Note that the active book was just set from a known-good source (a save). */
export function markPriceBookFresh(now: number = Date.now()): void {
  state().loadedAt = now;
}

/** Test helper. */
export function forgetPriceBookFreshness(): void {
  const s = state();
  s.loadedAt = 0;
  s.retryAt = 0;
  s.inflight = null;
}

/**
 * Re-read the stored book and make it the active one. Concurrent callers share
 * one read. Never rejects.
 */
export function refreshPriceBook(reader: PriceBookReader): Promise<void> {
  const s = state();
  if (s.inflight) return s.inflight;

  s.inflight = (async () => {
    try {
      const row = await reader.schoolSetting.findFirst({
        where: { key: PRICE_BOOK_KEY, tenantRef: { slug: DEFAULT_TENANT_SLUG } },
        select: { value: true },
      });
      // No row = nothing ever saved = the built-in defaults. `parsePriceBook`
      // returns exactly that for a null.
      setActivePriceBook(parsePriceBook(row?.value ?? null));
      s.loadedAt = Date.now();
    } catch (error) {
      s.retryAt = Date.now() + RETRY_AFTER_FAILURE_MS;
      console.error("price-book: could not refresh, keeping the last known prices", error);
    } finally {
      s.inflight = null;
    }
  })();

  return s.inflight;
}

/**
 * Runs in front of every model query in the app. `reader` must be a client
 * BELOW this extension in the chain (prisma.ts hands in the cold-start-retry
 * client) — reading the book through the extended client would make the refresh
 * itself trigger a refresh and wait on itself forever.
 */
export function createPriceBookExtension(reader: PriceBookReader) {
  return Prisma.defineExtension({
    name: "price-book-freshness",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          if (!priceBookIsFresh()) await refreshPriceBook(reader);
          return query(args);
        },
      },
    },
  });
}
