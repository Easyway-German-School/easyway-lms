import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/**
 * GET — a rep's own commission entries (read-only: see
 * src/lib/growth/commission.ts, the only code that ever writes this table).
 * `?scope=all` is the approval desk's view across every rep, gated on
 * `payroll` ALONE — not `growth` — since the person approving a payout is
 * typically an accountant with no Growth Desk access at all (see
 * admin-roles.ts's `accountant` role: payments/reports/payroll, no
 * `growth`). Gating scope=all behind `growth` first, as this route
 * originally did, meant the one page that could call it 403'd before ever
 * reaching the payroll check — which is exactly why nothing in the admin
 * UI ever called it.
 */
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope");
  const wantsAll = scope === "all";

  const gate = await requireCapability(wantsAll ? "payroll" : "growth");
  if (!gate.ok) return gate.response;

  const entries = await prisma.commissionEntry.findMany({
    where: wantsAll ? {} : { repId: gate.admin.userId },
    include: {
      lead: { select: { id: true, name: true, email: true } },
      rep: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return NextResponse.json({
    entries,
    // Not a real business figure yet — see src/lib/growth/commission.ts.
    rateConfirmed: false,
  });
}

/** PATCH — approve a payout. `payroll` only; a rep can never touch this. */
export async function PATCH(req: NextRequest) {
  const gate = await requireCapability("payroll");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const { entryId } = (body || {}) as Record<string, unknown>;
  if (typeof entryId !== "string" || !entryId) {
    return NextResponse.json({ error: "entryId is required" }, { status: 400 });
  }

  await prisma.commissionEntry.update({
    where: { id: entryId },
    data: { status: "approved", approvedById: gate.admin.userId, approvedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
