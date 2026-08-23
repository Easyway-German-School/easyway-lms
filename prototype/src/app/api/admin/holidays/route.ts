import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Dates the private-class series generator skips instead of booking over.
 * See `generateOccurrences` in src/lib/private-class-series.ts — every
 * candidate date is checked against this table, branch-specific first, then
 * school-wide (`branchId: null`).
 */

export async function GET() {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const holidays = await prisma.schoolHoliday.findMany({
    where: { date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    include: { branch: { select: { name: true } } },
    orderBy: { date: "asc" },
  });

  return NextResponse.json({
    holidays: holidays.map((h) => ({ id: h.id, date: h.date, label: h.label, branchId: h.branchId, branchName: h.branch?.name ?? null })),
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const date = typeof body?.date === "string" ? new Date(body.date) : new Date("invalid");
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    const branchId = typeof body?.branchId === "string" && body.branchId ? body.branchId : null;

    if (Number.isNaN(date.getTime()) || !label) {
      return NextResponse.json({ error: "A date and a label are both required" }, { status: 400 });
    }

    const holiday = await prisma.schoolHoliday.create({
      data: { date, label, branchId, tenantId: gate.session.user.tenantId },
    });
    return NextResponse.json({ holiday }, { status: 201 });
  } catch (error) {
    console.error("Holiday POST failed:", error);
    return NextResponse.json({ error: "Could not add this holiday" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await prisma.schoolHoliday.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
