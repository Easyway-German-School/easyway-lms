import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { KIND, notify } from "@/lib/notify";
import { NextRequest, NextResponse } from "next/server";

/** Local-day bounds [00:00, 24:00) for a date, so "on this day" is unambiguous. */
function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

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

    // Retro-skip: any private class already booked on that day (for this branch,
    // or every branch when the holiday is school-wide) is marked skipped and
    // the student told — a holiday added after the calendar was built should
    // still empty that day.
    const { start, end } = dayBounds(date);
    const affected = await prisma.privateClass.findMany({
      where: {
        scheduledAt: { gte: start, lt: end },
        status: { in: ["scheduled", "postponed"] },
        ...(branchId ? { student: { branchId } } : {}),
      },
      select: { id: true, student: { select: { userId: true } } },
    });
    if (affected.length > 0) {
      await prisma.privateClass.updateMany({
        where: { id: { in: affected.map((c) => c.id) } },
        data: { status: "skipped", notes: `Skipped — ${label}` },
      });
      await notify({
        to: { userIds: affected.map((c) => c.student.userId) },
        kind: KIND.privateClassUpdated,
        severity: "warning",
        title: "Class skipped for a holiday",
        message: `Your private class has been skipped — ${label}. Your tutor will arrange a replacement.`,
        link: "/calendar",
        dedupeKey: `holiday-skip:${holiday.id}`,
      }).catch(() => {});
    }

    return NextResponse.json({ holiday, skipped: affected.length }, { status: 201 });
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

  const holiday = await prisma.schoolHoliday.findUnique({ where: { id } });
  await prisma.schoolHoliday.delete({ where: { id } }).catch(() => {});

  // Put back the private classes this holiday skipped, so removing a
  // mistakenly-added holiday isn't a one-way door.
  let restored = 0;
  if (holiday) {
    const { start, end } = dayBounds(holiday.date);
    const rows = await prisma.privateClass.findMany({
      where: {
        scheduledAt: { gte: start, lt: end },
        status: "skipped",
        notes: `Skipped — ${holiday.label}`,
        ...(holiday.branchId ? { student: { branchId: holiday.branchId } } : {}),
      },
      select: { id: true, student: { select: { userId: true } } },
    });
    if (rows.length > 0) {
      await prisma.privateClass.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: "scheduled", notes: null },
      });
      restored = rows.length;
      await notify({
        to: { userIds: rows.map((r) => r.student.userId) },
        kind: KIND.privateClassUpdated,
        severity: "info",
        title: "Class back on",
        message: `A holiday was removed — your private class on ${holiday.date.toLocaleDateString()} is scheduled again.`,
        link: "/calendar",
        dedupeKey: `holiday-restore:${holiday.id}`,
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, restored });
}
