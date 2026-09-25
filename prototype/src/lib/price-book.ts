/**
 * THE PRICE BOOK — every naira figure the school charges for tuition, as data.
 *
 * These numbers used to be constants in payment.ts, so a price change meant a
 * code edit and a deploy. They now live in a `SchoolSetting` row (key
 * `pricing.book`, edited on /admin/settings/pricing) and this file is the
 * shape, the defaults, and the parser that turns whatever is stored into a
 * safe, complete book.
 *
 * This module is PURE and client-safe — no Prisma, no server imports — because
 * payment.ts imports it and payment.ts is also bundled into client components.
 * Loading the stored row and keeping it fresh is price-book-refresh.ts.
 *
 * The defaults below are what the school charges when nothing has been saved,
 * and what any single missing or junk cell in a stored book falls back to. So
 * a half-broken row can never leave a level without a price: the worst case is
 * that one cell shows the default instead of the edited value.
 */

/** The `SchoolSetting.key` the price book is stored under. */
export const PRICE_BOOK_KEY = "pricing.book";

/** Which fee schedule a branch bills on. Chosen by branch name — see payment.ts. */
export type FeeTier = "premium" | "standard" | "online";

/** The levels the school sells. C2 is retired and deliberately not priced. */
export const PRICE_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
/** Exam Preparatory only runs A1–B2 — there is no C1 sitting in this package. */
export const EXAM_PREP_LEVELS = ["A1", "A2", "B1", "B2"] as const;
export const FEE_TIERS: readonly FeeTier[] = ["standard", "premium", "online"];

/** Level → whole naira. Indexed by an upper-cased level string. */
export type LevelPrices = Record<string, number>;

export type PriceBook = {
  /** Group tuition, by branch tier and level. */
  group: Record<FeeTier, LevelPrices>;
  /** Private (one-to-one) tuition — priced by level, whatever the branch. */
  private: LevelPrices;
  /**
   * Exam Preparatory: its own per-level ladder, A1–B2 only, on top of the
   * standard group/private ladders rather than replacing them — a student on
   * this pathway pays this table's figure regardless of branch or class type,
   * the same way Travel Package overrides but level-keyed instead of flat.
   */
  examPrep: LevelPrices;
  /**
   * Travel Package: one flat price for the whole programme (replaces the
   * per-level ladder), and the smallest first payment that opens the portal.
   */
  travelPackage: { price: number; minFirstPayment: number };
};

export const DEFAULT_PRICE_BOOK: PriceBook = {
  group: {
    // Lagos, Port Harcourt, Ghana, and any campus branch added later
    standard: { A1: 150000, A2: 150000, B1: 180000, B2: 180000, C1: 350000 },
    // Abuja
    premium: { A1: 180000, A2: 180000, B1: 200000, B2: 200000, C1: 350000 },
    // Online cohort
    online: { A1: 150000, A2: 150000, B1: 180000, B2: 180000, C1: 350000 },
  },
  private: { A1: 300000, A2: 300000, B1: 360000, B2: 360000, C1: 350000 },
  examPrep: { A1: 100000, A2: 110000, B1: 120000, B2: 130000 },
  travelPackage: { price: 980000, minFirstPayment: 200000 },
};

/** A sanity ceiling, not a business rule — catches an extra zero typed into a box. */
export const MAX_PRICE = 50_000_000;

function clone(book: PriceBook): PriceBook {
  return {
    group: {
      standard: { ...book.group.standard },
      premium: { ...book.group.premium },
      online: { ...book.group.online },
    },
    private: { ...book.private },
    examPrep: { ...book.examPrep },
    travelPackage: { ...book.travelPackage },
  };
}

export function defaultPriceBook(): PriceBook {
  return clone(DEFAULT_PRICE_BOOK);
}

function asPrice(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const whole = Math.round(n);
  return whole > 0 && whole <= MAX_PRICE ? whole : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Lenient parse — for READING a stored book. Starts from the defaults and
 * overlays every cell that is a sane price; anything else is ignored, so a
 * hand-edited or half-written row degrades to defaults cell by cell instead of
 * failing the whole app.
 */
export function parsePriceBook(raw: unknown): PriceBook {
  const book = defaultPriceBook();
  if (!isRecord(raw)) return book;

  if (isRecord(raw.group)) {
    for (const tier of FEE_TIERS) {
      const stored = raw.group[tier];
      if (!isRecord(stored)) continue;
      for (const level of PRICE_LEVELS) {
        const price = asPrice(stored[level]);
        if (price !== null) book.group[tier][level] = price;
      }
    }
  }

  if (isRecord(raw.private)) {
    for (const level of PRICE_LEVELS) {
      const price = asPrice(raw.private[level]);
      if (price !== null) book.private[level] = price;
    }
  }

  if (isRecord(raw.examPrep)) {
    for (const level of EXAM_PREP_LEVELS) {
      const price = asPrice(raw.examPrep[level]);
      if (price !== null) book.examPrep[level] = price;
    }
  }

  if (isRecord(raw.travelPackage)) {
    const price = asPrice(raw.travelPackage.price);
    const floor = asPrice(raw.travelPackage.minFirstPayment);
    if (price !== null) book.travelPackage.price = price;
    if (floor !== null) book.travelPackage.minFirstPayment = floor;
    // A first-payment floor above the package price could never be met.
    if (book.travelPackage.minFirstPayment > book.travelPackage.price) {
      book.travelPackage.minFirstPayment = book.travelPackage.price;
    }
  }

  return book;
}

export type StrictParse = { ok: true; book: PriceBook } | { ok: false; error: string };

const TIER_LABEL: Record<FeeTier, string> = {
  standard: "Standard campuses",
  premium: "Abuja",
  online: "Online",
};

/**
 * Strict parse — for WRITING. The admin form sends the whole book, so every
 * cell must be present and a real price; the first bad one is named in the
 * error. Nothing is silently defaulted here — saving a typo'd blank as the old
 * default would look like the edit worked.
 */
export function parsePriceBookStrict(raw: unknown): StrictParse {
  if (!isRecord(raw)) return { ok: false, error: "No price list was sent." };
  const book = defaultPriceBook();

  for (const tier of FEE_TIERS) {
    const stored = isRecord(raw.group) ? raw.group[tier] : null;
    for (const level of PRICE_LEVELS) {
      const price = asPrice(isRecord(stored) ? stored[level] : null);
      if (price === null) {
        return { ok: false, error: `${TIER_LABEL[tier]} ${level}: enter a price in naira (more than ₦0).` };
      }
      book.group[tier][level] = price;
    }
  }

  for (const level of PRICE_LEVELS) {
    const price = asPrice(isRecord(raw.private) ? raw.private[level] : null);
    if (price === null) {
      return { ok: false, error: `Private ${level}: enter a price in naira (more than ₦0).` };
    }
    book.private[level] = price;
  }

  for (const level of EXAM_PREP_LEVELS) {
    const price = asPrice(isRecord(raw.examPrep) ? raw.examPrep[level] : null);
    if (price === null) {
      return { ok: false, error: `Exam Preparatory ${level}: enter a price in naira (more than ₦0).` };
    }
    book.examPrep[level] = price;
  }

  const travel = isRecord(raw.travelPackage) ? raw.travelPackage : {};
  const price = asPrice(travel.price);
  const floor = asPrice(travel.minFirstPayment);
  if (price === null) return { ok: false, error: "Travel Package: enter the package price in naira." };
  if (floor === null) return { ok: false, error: "Travel Package: enter the minimum first payment in naira." };
  if (floor > price) {
    return { ok: false, error: "Travel Package: the minimum first payment cannot be more than the package price." };
  }
  book.travelPackage = { price, minFirstPayment: floor };

  return { ok: true, book };
}

/** Which cells differ between two books — for the audit trail and the save toast. */
export function diffPriceBooks(before: PriceBook, after: PriceBook): Array<{ label: string; from: number; to: number }> {
  const out: Array<{ label: string; from: number; to: number }> = [];
  for (const tier of FEE_TIERS) {
    for (const level of PRICE_LEVELS) {
      const from = before.group[tier][level];
      const to = after.group[tier][level];
      if (from !== to) out.push({ label: `${TIER_LABEL[tier]} ${level}`, from, to });
    }
  }
  for (const level of PRICE_LEVELS) {
    if (before.private[level] !== after.private[level]) {
      out.push({ label: `Private ${level}`, from: before.private[level], to: after.private[level] });
    }
  }
  for (const level of EXAM_PREP_LEVELS) {
    if (before.examPrep[level] !== after.examPrep[level]) {
      out.push({ label: `Exam Preparatory ${level}`, from: before.examPrep[level], to: after.examPrep[level] });
    }
  }
  if (before.travelPackage.price !== after.travelPackage.price) {
    out.push({ label: "Travel Package price", from: before.travelPackage.price, to: after.travelPackage.price });
  }
  if (before.travelPackage.minFirstPayment !== after.travelPackage.minFirstPayment) {
    out.push({
      label: "Travel Package minimum first payment",
      from: before.travelPackage.minFirstPayment,
      to: after.travelPackage.minFirstPayment,
    });
  }
  return out;
}

/**
 * The book every fee lookup reads when the caller does not hand one in.
 *
 * Held on `globalThis`, not in a module variable: Next bundles server code per
 * layer (route handlers, server components, the client), and a plain module
 * variable can end up as several independent copies — the refresher would
 * update one while `tuitionFeeFor` read another and prices would silently
 * never change. prisma.ts caches its client on `global` for the same reason.
 */
const ACTIVE = Symbol.for("easyway.priceBook.active");
type Holder = { [ACTIVE]?: PriceBook };
const holder = globalThis as unknown as Holder;

export function getActivePriceBook(): PriceBook {
  return holder[ACTIVE] ?? DEFAULT_PRICE_BOOK;
}

export function setActivePriceBook(book: PriceBook): void {
  holder[ACTIVE] = book;
}

/** Test helper — back to the built-in defaults. */
export function resetActivePriceBook(): void {
  delete holder[ACTIVE];
}
