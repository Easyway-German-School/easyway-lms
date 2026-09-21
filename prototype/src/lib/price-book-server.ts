import { guardedPrisma, priceBookReader } from "@/lib/prisma";
import {
  PRICE_BOOK_KEY,
  getActivePriceBook,
  setActivePriceBook,
  type PriceBook,
} from "@/lib/price-book";
import { markPriceBookFresh, priceBookIsFresh, refreshPriceBook } from "@/lib/price-book-refresh";

/**
 * The server-side handles on the price book that ROUTES use — the read/write
 * counterpart to the invisible refresh in price-book-refresh.ts.
 *
 * Prices are one set for the whole deployment, held as a `SchoolSetting` row on
 * the DEFAULT tenant (`DEFAULT_TENANT_SLUG`) — the same place the platform rate
 * card lives (src/lib/usage/rates.ts). Every fee lookup in the code is
 * tenant-agnostic today, so a per-tenant book would be a lie; if schools ever
 * need their own prices, the lookups need a tenant first.
 */

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || "easyway";

/**
 * Make sure the active book is current, and return it. For routes that may
 * answer WITHOUT touching the database otherwise (`/api/pricing`), where the
 * refresh-before-every-query extension would never get a chance to run.
 */
export async function ensurePriceBook(): Promise<PriceBook> {
  if (!priceBookIsFresh()) await refreshPriceBook(priceBookReader());
  return getActivePriceBook();
}

export async function defaultTenantId(): Promise<string | null> {
  const tenant = await guardedPrisma.tenant.findUnique({
    where: { slug: DEFAULT_TENANT_SLUG },
    select: { id: true },
  });
  return tenant?.id ?? null;
}

/** When the stored book was last saved, or null if it never has been (still on defaults). */
export async function readPriceBookSavedAt(): Promise<string | null> {
  const row = await guardedPrisma.schoolSetting.findFirst({
    where: { key: PRICE_BOOK_KEY, tenantRef: { slug: DEFAULT_TENANT_SLUG } },
    select: { updatedAt: true },
  });
  return row?.updatedAt.toISOString() ?? null;
}

/**
 * Persist a book and make it live in THIS instance immediately; other
 * instances pick it up within the refresh window (15s).
 */
export async function savePriceBook(book: PriceBook, tenantId: string): Promise<void> {
  await guardedPrisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: PRICE_BOOK_KEY } },
    create: { tenantId, key: PRICE_BOOK_KEY, value: book },
    update: { value: book },
  });
  setActivePriceBook(book);
  markPriceBookFresh();
}
