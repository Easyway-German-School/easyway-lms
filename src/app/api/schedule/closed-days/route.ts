import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The days a class calendar should draw as "Closed" — school holidays, from
 * `SchoolHoliday`. The admin already has a full CRUD view at
 * /api/admin/holidays (capability-gated); this is the read-only, staff-wide
 * version the tutor timetable and the admin schedule calendar consume to hatch
 * a day and label it.
 *
 * `branchId` narrows to that branch plus the school-wide entries (`branchId:
 * null`); without it you get every holiday. Rows are already tenant-scoped by
 * `requireAuthSession` (see `setTenantScope` in lib/auth.ts).
 */
export async function GET(req: NextRequest) {
  const session = await requireAuthSession();
  const role = (session?.user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return NextResponse.json({ error: "Staff access required" }, { status: 403 });
  }

  const branchId = req.nextUrl.searchParams.get("branchId");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const holidays = await prisma.schoolHoliday.findMany({
    where: {
      date: { gte: startOfToday },
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
    },
    orderBy: { date: "asc" },
    select: { id: true, date: true, label: true, branchId: true },
  });

  return NextResponse.json({ closedDays: holidays });
}
