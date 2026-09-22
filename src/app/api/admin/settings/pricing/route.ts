import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { DEFAULT_PRICE_BOOK, diffPriceBooks, parsePriceBookStrict } from "@/lib/price-book";
import {
  defaultTenantId,
  ensurePriceBook,
  readPriceBookSavedAt,
  savePriceBook,
} from "@/lib/price-book-server";

/**
 * The school's price list, read and written by /admin/settings/pricing.
 *
 *   GET   → the live book, the built-in defaults (for "reset"), and when it was
 *           last saved (null = never; still on the defaults).
 *   POST  { book } → validate every cell, save, and make it live. No deploy.
 *
 * Gated on `payments`, not `staff`: this is what the school charges, the most
 * consequential number in the app, and the fee book is already withheld from
 * anyone without that capability.
 *
 * Saving changes what NEW charges are priced at and what the checkout quotes.
 * It deliberately does NOT touch charges already on a student's ledger — those
 * are frozen by design. The companion route (./charges) lists the ones that
 * now disagree with the list and lets an admin correct them one by one.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  try {
    const book = await ensurePriceBook();
    return NextResponse.json({
      book,
      defaults: DEFAULT_PRICE_BOOK,
      savedAt: await readPriceBookSavedAt(),
    });
  } catch (error) {
    console.error("Failed to load the price book:", error);
    return NextResponse.json({ error: "Unable to load the price list" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json().catch(() => null);
    const parsed = parsePriceBookStrict(body?.book);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    // Prices are one set for the whole deployment, held on the default school.
    // An admin from any other tenant must not be able to rewrite them.
    const tenantId = await defaultTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "No default school is set up to hold the price list." }, { status: 500 });
    }
    const sessionTenant = gate.session.user.tenantId;
    if (sessionTenant && sessionTenant !== tenantId) {
      return NextResponse.json({ error: "Prices are set by the main school's admins." }, { status: 403 });
    }

    const before = await ensurePriceBook();
    const changes = diffPriceBooks(before, parsed.book);
    if (!changes.length) {
      return NextResponse.json({ ok: true, book: before, changes: [] });
    }

    await savePriceBook(parsed.book, tenantId);

    await writeAudit(unguardedPrisma, {
      action: "priceBookSaved",
      model: "SchoolSetting",
      affectedCount: changes.length,
      severity: "notice",
      summary: `Price list changed: ${changes
        .map((c) => `${c.label} ₦${c.from.toLocaleString("en-NG")} → ₦${c.to.toLocaleString("en-NG")}`)
        .join("; ")}`,
      before,
      after: parsed.book,
    });

    return NextResponse.json({ ok: true, book: parsed.book, changes });
  } catch (error) {
    console.error("Failed to save the price book:", error);
    return NextResponse.json({ error: "Unable to save the price list" }, { status: 500 });
  }
}
