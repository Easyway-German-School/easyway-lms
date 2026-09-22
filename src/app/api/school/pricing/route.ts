import { NextResponse } from "next/server";

import { DEFAULT_PRICE_BOOK } from "@/lib/price-book";
import { ensurePriceBook } from "@/lib/price-book-server";

/**
 * The school's current price list, for client components.
 *
 * The prices are marketed publicly, so this needs no auth — same reasoning as
 * /api/school/sessions. It exists because fee lookups in the BROWSER (the upsell
 * card, the lock screen's one-to-one option, the Travel Package card) have no
 * database to read the price book from; without this they would show whatever
 * was baked into the JavaScript bundle at build time, which is exactly the
 * "changing a price needs a deploy" problem this whole feature removes.
 *
 * Never cached: a stale price shown next to a checkout that charges the new one
 * is worse than one extra tiny request.
 *
 * Falls back to the built-in defaults on any error so a card never loses its
 * price because a settings read hiccuped.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const book = await ensurePriceBook();
    return NextResponse.json(book, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load the price book:", error);
    return NextResponse.json(DEFAULT_PRICE_BOOK, { headers: { "Cache-Control": "no-store" } });
  }
}
