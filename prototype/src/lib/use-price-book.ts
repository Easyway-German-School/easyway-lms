"use client";

import { useEffect, useState } from "react";

import { parsePriceBook, setActivePriceBook, type PriceBook } from "@/lib/price-book";

/**
 * The school's live price list, in the browser.
 *
 * Returns `null` until the first response lands — a component should show a
 * placeholder for the price, not the built-in default, because the default is
 * exactly the number that may have just been changed. (A flash of the OLD price
 * next to a checkout that charges the NEW one is the bug this prevents.)
 *
 * Shared across every component on a page: one request per 30 seconds however
 * many cards ask. On success it also becomes the browser's ACTIVE book, so the
 * pure `tuitionFeeFor(...)` calls that some client code makes agree with it.
 */

const TTL_MS = 30_000;

let cached: { book: PriceBook; at: number } | null = null;
let inflight: Promise<PriceBook | null> | null = null;

function fetchBook(): Promise<PriceBook | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.book);
  if (inflight) return inflight;

  inflight = fetch("/api/school/pricing", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;
      const book = parsePriceBook(await res.json());
      cached = { book, at: Date.now() };
      setActivePriceBook(book);
      return book;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function usePriceBook(): PriceBook | null {
  // Always starts empty and fills in the effect below. A cached book resolves on the
  // next microtask, so the placeholder is never visible for more than a frame — and
  // rendering never has to read the clock.
  const [book, setBook] = useState<PriceBook | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchBook().then((next) => {
      if (alive && next) setBook(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return book;
}
