import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, adminHasCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/**
 * GET — a rep's own commission entries (read-only: see
 * src/lib/growth/commission.ts, the only code that ever writes this table).
 * `?scope=all` additionally requires `payroll` — the approval desk's view
 * across every rep, same split as the rest of this module: `growth` is the
 * pipeline, `payroll` is money going out to staff.
 */
export async function GET(req: NextRequest) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const scope = req.nextUrl.searchParams.get("scope");
  const wantsAll = scope === "all";
  if (wantsAll && !(await adminHasCapability(gate.admin.userId, "payroll"))) {
    return NextResponse.json({ error: "Your admin role does not cover payroll" }, { status: 403 });
  }

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
