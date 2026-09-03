import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdmin } from "@/lib/admin-roles";
import { runWithTenant } from "@/lib/tenant/context";
import { visibleEventsWhere, expandOccurrences } from "@/lib/work-drive/events";
import { buildCalendar, verifyIcsToken, type IcsEvent } from "@/lib/work-drive/ics";

export const dynamic = "force-dynamic";

/**
 * GET ?u=&token= — the signed read-only calendar feed. No session (a calendar
 * client cannot sign in); the HMAC token stands in for one, and we re-check on
 * every fetch that `u` is still an admin holding the `events` capability.
 *
 * Window: 30 days back to 120 days forward, recurrences expanded.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u") || "";
  const token = url.searchParams.get("token") || "";
  if (!userId || !token || !verifyIcsToken(userId, token)) {
    return new NextResponse("Invalid feed link.", { status: 401 });
  }

  const admin = await resolveAdmin(userId);
  if (!admin || !admin.can("events")) {
    return new NextResponse("This feed is no longer available.", { status: 403 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true } });
  if (!user?.tenantId) {
    return new NextResponse(buildCalendar([]), { headers: { "Content-Type": "text/calendar; charset=utf-8" } });
  }
  const from = new Date(Date.now() - 30 * 86400_000);
  const to = new Date(Date.now() + 120 * 86400_000);

  // The public route has no tenant in context; run the read inside the feed
  // owner's tenant so the isolation extension scopes it.
  const events = await runWithTenant(user.tenantId, () =>
    prisma.workEvent.findMany({
      where: {
        deletedAt: null,
        status: { not: "cancelled" },
        OR: [{ startAt: { lte: to } }, { rrule: { not: null } }],
        ...visibleEventsWhere(admin),
      },
      select: {
        id: true, title: true, description: true, location: true,
        startAt: true, endAt: true, allDay: true, rrule: true,
      },
    }),
  );

  const items: IcsEvent[] = [];
  for (const e of events) {
    for (const occ of expandOccurrences(e, from, to)) {
      items.push({
        id: `${e.id}-${occ.startAt.getTime()}`,
        title: e.title,
        description: e.description,
        location: e.location,
        startAt: occ.startAt,
        endAt: occ.endAt,
        allDay: e.allDay,
      });
    }
  }

  return new NextResponse(buildCalendar(items), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="work-drive.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
