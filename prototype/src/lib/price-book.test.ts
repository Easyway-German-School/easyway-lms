import { afterEach, describe as suite, expect, it, vi } from "vitest";

import {
  DEFAULT_PRICE_BOOK,
  PRICE_BOOK_KEY,
  defaultPriceBook,
  diffPriceBooks,
  getActivePriceBook,
  parsePriceBook,
  parsePriceBookStrict,
  resetActivePriceBook,
  setActivePriceBook,
  type PriceBook,
} from "./price-book";
import {
  forgetPriceBookFreshness,
  markPriceBookFresh,
  priceBookIsFresh,
  refreshPriceBook,
  type PriceBookReader,
} from "./price-book-refresh";
import {
  priceListForBranch,
  privateClassPriceForLevel,
  requiredDepositFor,
  travelPackageMinFirstPayment,
  travelPackagePrice,
  tuitionFeeFor,
} from "./payment";

afterEach(() => {
  resetActivePriceBook();
  forgetPriceBookFreshness();
  vi.restoreAllMocks();
});

function edited(mutate: (book: PriceBook) => void): PriceBook {
  const book = defaultPriceBook();
  mutate(book);
  return book;
}

suite("the built-in prices", () => {
  it("private tuition is A1/A2 ₦300,000 and B1/B2 ₦360,000", () => {
    expect(privateClassPriceForLevel("A1")).toBe(300_000);
    expect(privateClassPriceForLevel("A2")).toBe(300_000);
    expect(privateClassPriceForLevel("B1")).toBe(360_000);
    expect(privateClassPriceForLevel("B2")).toBe(360_000);
  });

  it("private is priced by level, not by branch", () => {
    for (const branch of ["Lagos", "Abuja", "Port Harcourt", "Online", null]) {
      expect(tuitionFeeFor({ level: "A1", branch, classType: "private" })).toBe(300_000);
      expect(tuitionFeeFor({ level: "B2", branch, classType: "private" })).toBe(360_000);
    }
  });

  it("group tuition still follows the branch tier", () => {
    expect(tuitionFeeFor({ level: "A1", branch: "Lagos" })).toBe(150_000);
    expect(tuitionFeeFor({ level: "A1", branch: "Abuja" })).toBe(180_000);
    expect(tuitionFeeFor({ level: "B1", branch: "Online" })).toBe(180_000);
  });

  it("the deposit is 60% of the private price — A1 private opens at ₦180,000", () => {
    // The case that started this: a student who paid ₦180,000 of a ₦300,000 fee.
    expect(requiredDepositFor({ level: "A1", branch: "Lagos", classType: "private" })).toBe(180_000);
  });

  it("an unknown level falls back to the C1 private price rather than under-quoting", () => {
    expect(privateClassPriceForLevel("C2")).toBe(DEFAULT_PRICE_BOOK.private.C1);
    expect(privateClassPriceForLevel(null)).toBe(DEFAULT_PRICE_BOOK.private.C1);
  });
});

suite("editing the price book changes every lookup with no code change", () => {
  it("tuitionFeeFor, the deposit and the price list all follow the active book", () => {
    setActivePriceBook(
      edited((b) => {
        b.private.A1 = 310_000;
        b.group.standard.A1 = 160_000;
      }),
    );

    expect(tuitionFeeFor({ level: "A1", branch: "Lagos", classType: "private" })).toBe(310_000);
    expect(requiredDepositFor({ level: "A1", branch: "Lagos", classType: "private" })).toBe(186_000);
    expect(tuitionFeeFor({ level: "A1", branch: "Lagos" })).toBe(160_000);

    const privateList = priceListForBranch("Lagos", "private");
    expect(privateList.find((row) => row.level === "A1")?.tuitionFee).toBe(310_000);
    const groupList = priceListForBranch("Lagos");
    expect(groupList.find((row) => row.level === "A1")?.tuitionFee).toBe(160_000);
  });

  it("an explicit book wins over the active one", () => {
    setActivePriceBook(edited((b) => (b.private.A1 = 999_000)));
    const other = edited((b) => (b.private.A1 = 305_000));
    expect(privateClassPriceForLevel("A1", other)).toBe(305_000);
    expect(tuitionFeeFor({ level: "A1", classType: "private" }, other)).toBe(305_000);
  });

  it("Travel Package price and its first-payment floor come from the book", () => {
    setActivePriceBook(edited((b) => (b.travelPackage = { price: 1_100_000, minFirstPayment: 250_000 })));
    expect(travelPackagePrice()).toBe(1_100_000);
    expect(travelPackageMinFirstPayment()).toBe(250_000);
    expect(tuitionFeeFor({ level: "B1", branch: "Abuja", classType: "private", pathway: "Travel Package" })).toBe(
      1_100_000,
    );
    // Flat floor, not 60% of the package.
    expect(requiredDepositFor({ level: "A1", pathway: "Travel Package" })).toBe(250_000);
  });

  it("Exam Preparatory's per-level ladder comes from the book", () => {
    setActivePriceBook(edited((b) => (b.examPrep.A1 = 105_000)));
    expect(tuitionFeeFor({ level: "A1", branch: "Lagos", pathway: "Exam Preparatory" })).toBe(105_000);
    expect(requiredDepositFor({ level: "A1", branch: "Lagos", pathway: "Exam Preparatory" })).toBe(63_000);
  });

  it("reverts to the defaults when the active book is reset", () => {
    setActivePriceBook(edited((b) => (b.private.A1 = 1)));
    resetActivePriceBook();
    expect(getActivePriceBook()).toEqual(DEFAULT_PRICE_BOOK);
  });
});

suite("parsePriceBook — reading what is stored", () => {
  it("returns the defaults for nothing, null or junk", () => {
    for (const raw of [undefined, null, "x", 12, [], {}]) {
      expect(parsePriceBook(raw)).toEqual(DEFAULT_PRICE_BOOK);
    }
  });

  it("overlays valid cells and ignores bad ones, cell by cell", () => {
    const book = parsePriceBook({
      private: { A1: 310_000, A2: "abc", B1: -5, B2: 0, C1: 1e12 },
      group: { standard: { A1: "165000" }, premium: "nope" },
    });
    expect(book.private.A1).toBe(310_000); // valid → applied
    expect(book.private.A2).toBe(300_000); // junk → default
    expect(book.private.B1).toBe(360_000); // negative → default
    expect(book.private.B2).toBe(360_000); // zero → default
    expect(book.private.C1).toBe(350_000); // absurd → default
    expect(book.group.standard.A1).toBe(165_000); // numeric string accepted
    expect(book.group.premium).toEqual(DEFAULT_PRICE_BOOK.group.premium);
  });

  it("never lets the first-payment floor exceed the package price", () => {
    const book = parsePriceBook({ travelPackage: { price: 500_000, minFirstPayment: 900_000 } });
    expect(book.travelPackage.minFirstPayment).toBe(500_000);
  });

  it("does not mutate the shared defaults", () => {
    const book = parsePriceBook({ private: { A1: 1_234 } });
    book.private.A2 = 1;
    expect(DEFAULT_PRICE_BOOK.private.A1).toBe(300_000);
    expect(DEFAULT_PRICE_BOOK.private.A2).toBe(300_000);
  });

  it("overlays Exam Preparatory cells, A1–B2 only, ignoring bad ones", () => {
    const book = parsePriceBook({ examPrep: { A1: 101_000, A2: "abc", B1: -5, B2: 0 } });
    expect(book.examPrep.A1).toBe(101_000);
    expect(book.examPrep.A2).toBe(110_000);
    expect(book.examPrep.B1).toBe(120_000);
    expect(book.examPrep.B2).toBe(130_000);
  });
});

suite("parsePriceBookStrict — validating a save", () => {
  it("accepts a complete, sane book", () => {
    const parsed = parsePriceBookStrict(edited((b) => (b.private.B1 = 365_000)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.book.private.B1).toBe(365_000);
  });

  it("rejects a missing cell and names it", () => {
    const partial = defaultPriceBook() as unknown as { private: Record<string, unknown> };
    delete partial.private.A2;
    const parsed = parsePriceBookStrict(partial);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("Private A2");
  });

  it("rejects zero, negative and non-numeric prices rather than defaulting them", () => {
    for (const bad of [0, -100, "abc", null, NaN]) {
      const book = defaultPriceBook() as unknown as { group: { premium: Record<string, unknown> } };
      book.group.premium.A1 = bad;
      const parsed = parsePriceBookStrict(book);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain("Abuja A1");
    }
  });

  it("rejects a Travel Package floor above the package price", () => {
    const parsed = parsePriceBookStrict(edited((b) => (b.travelPackage = { price: 400_000, minFirstPayment: 500_000 })));
    expect(parsed.ok).toBe(false);
  });

  it("rejects a body that is not an object", () => {
    expect(parsePriceBookStrict(null).ok).toBe(false);
    expect(parsePriceBookStrict("x").ok).toBe(false);
  });

  it("rejects a missing Exam Preparatory cell and names it", () => {
    const partial = defaultPriceBook() as unknown as { examPrep: Record<string, unknown> };
    delete partial.examPrep.B1;
    const parsed = parsePriceBookStrict(partial);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("Exam Preparatory B1");
  });
});

suite("diffPriceBooks", () => {
  it("lists only the cells that changed, with readable labels", () => {
    const after = edited((b) => {
      b.private.A1 = 310_000;
      b.group.premium.B2 = 210_000;
      b.travelPackage.price = 1_000_000;
    });
    expect(diffPriceBooks(DEFAULT_PRICE_BOOK, after)).toEqual([
      { label: "Abuja B2", from: 200_000, to: 210_000 },
      { label: "Private A1", from: 300_000, to: 310_000 },
      { label: "Travel Package price", from: 980_000, to: 1_000_000 },
    ]);
  });

  it("is empty when nothing changed", () => {
    expect(diffPriceBooks(DEFAULT_PRICE_BOOK, defaultPriceBook())).toEqual([]);
  });

  it("lists a changed Exam Preparatory cell too", () => {
    const after = edited((b) => (b.examPrep.B2 = 135_000));
    expect(diffPriceBooks(DEFAULT_PRICE_BOOK, after)).toEqual([
      { label: "Exam Preparatory B2", from: 130_000, to: 135_000 },
    ]);
  });
});

function readerReturning(value: unknown): PriceBookReader & { findFirst: ReturnType<typeof vi.fn> } {
  const findFirst = vi.fn().mockResolvedValue(value === undefined ? null : { value });
  return { schoolSetting: { findFirst }, findFirst } as PriceBookReader & { findFirst: ReturnType<typeof vi.fn> };
}

suite("refreshPriceBook — the invisible refresh in front of every query", () => {
  it("reads the stored book from the price key and makes it active", async () => {
    const reader = readerReturning(edited((b) => (b.private.A1 = 305_000)));
    await refreshPriceBook(reader);

    expect(reader.findFirst).toHaveBeenCalledTimes(1);
    expect(reader.findFirst.mock.calls[0][0].where.key).toBe(PRICE_BOOK_KEY);
    expect(tuitionFeeFor({ level: "A1", classType: "private" })).toBe(305_000);
  });

  it("uses the defaults when nothing has ever been saved", async () => {
    setActivePriceBook(edited((b) => (b.private.A1 = 1)));
    await refreshPriceBook(readerReturning(undefined));
    expect(getActivePriceBook()).toEqual(DEFAULT_PRICE_BOOK);
  });

  it("shares one read between concurrent callers", async () => {
    const reader = readerReturning(defaultPriceBook());
    await Promise.all([refreshPriceBook(reader), refreshPriceBook(reader), refreshPriceBook(reader)]);
    expect(reader.findFirst).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good prices and does not throw when the read fails", async () => {
    setActivePriceBook(edited((b) => (b.private.A1 = 305_000)));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: PriceBookReader = {
      schoolSetting: { findFirst: vi.fn().mockRejectedValue(new Error("Can't reach database server")) },
    };

    await expect(refreshPriceBook(failing)).resolves.toBeUndefined();

    expect(privateClassPriceForLevel("A1")).toBe(305_000);
    // Backs off rather than hammering a database that is down.
    expect(priceBookIsFresh()).toBe(true);
  });

  it("goes stale after the window so the next query refreshes again", async () => {
    const t0 = 1_000_000;
    markPriceBookFresh(t0);
    expect(priceBookIsFresh(t0 + 5_000)).toBe(true);
    expect(priceBookIsFresh(t0 + 16_000)).toBe(false);
  });

  it("is stale from the start on a cold instance", () => {
    expect(priceBookIsFresh()).toBe(false);
  });
});
