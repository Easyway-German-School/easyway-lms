import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import {
  expandOccurrences,
  normalizeEventKind,
  normalizeEventStatus,
  normalizeEventVisibility,
  visibleEventsWhere,
} from "@/lib/work-drive/events";

export const dynamic = "force-dynamic";

/**
 * GET ?from=&to= — events (recurrences expanded) that overlap the window, plus
 * a lightweight attendee count. Defaults to the current month if the window is
 * missing.
 */
export async function GET(request: NextRequest) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const now = new Date();
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Bad date range." }, { status: 400 });
  }

  const events = await prisma.workEvent.findMany({
    where: {
      deletedAt: null,
      // A recurring event can start before the window and still have an
      // occurrence inside it, so we don't filter startAt here — expansion does.
      OR: [{ startAt: { lte: to } }, { rrule: { not: null } }],
      ...visibleEventsWhere(gate.admin),
    },
    select: {
      id: true,
      title: true,
      kind: true,
      location: true,
      startAt: true,
      endAt: true,
      allDay: true,
      rrule: true,
      timezone: true,
      visibility: true,
      status: true,
      workspaceId: true,
      workspace: { select: { name: true, slug: true } },
      _count: { select: { attendees: true } },
    },
  });

  const rows: object[] = [];
  for (const e of events) {
    for (const occ of expandOccurrences(e, from, to)) {
      rows.push({
        id: e.id,
        occurrenceStart: occ.startAt,
        occurrenceEnd: occ.endAt,
        title: e.title,
        kind: e.kind,
        location: e.location,
        allDay: e.allDay,
        recurring: Boolean(e.rrule),
        timezone: e.timezone,
        visibility: e.visibility,
        status: e.status,
        workspaceName: e.workspace?.name ?? null,
        workspaceSlug: e.workspace?.slug ?? null,
        attendeeCount: e._count.attendees,
      });
    }
  }
  rows.sort((a, b) => +new Date((a as any).occurrenceStart) - +new Date((b as any).occurrenceStart));

  return NextResponse.json({ from, to, events: rows });
}

/** POST — create an event. The creator is added as its host attendee. */
export async function POST(request: NextRequest) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  if (!tenantId) return NextResponse.json({ error: "This account has no calendar." }, { status: 400 });

  const b = await request.json().catch(() => null);
  const title = String(b?.title ?? "").trim();
  if (!title || title.length > 200) {
    return NextResponse.json({ error: "Give the event a title (up to 200 characters)." }, { status: 400 });
  }
  const startAt = new Date(b?.startAt);
  if (isNaN(startAt.getTime())) return NextResponse.json({ error: "A start time is required." }, { status: 400 });
  const endAt = b?.endAt ? new Date(b.endAt) : null;
  if (endAt && (isNaN(endAt.getTime()) || endAt < startAt)) {
    return NextResponse.json({ error: "The end time is before the start." }, { status: 400 });
  }

  const visibility = normalizeEventVisibility(b?.visibility);
  let workspaceId: string | null = null;
  if (visibility === "workspace") {
    const slug = String(b?.workspaceSlug ?? "").trim();
    const ws = slug ? await prisma.workspace.findFirst({ where: { slug, deletedAt: null }, select: { id: true } }) : null;
    if (!ws) return NextResponse.json({ error: "Pick a workspace for a workspace-visible event." }, { status: 400 });
    workspaceId = ws.id;
  }
  const branchId = visibility === "branch" ? String(b?.branchId ?? "").trim() || null : null;
  if (visibility === "branch" && !branchId) {
    return NextResponse.json({ error: "Pick a branch." }, { status: 400 });
  }

  const event = await prisma.workEvent.create({
    data: {
      title,
      description: String(b?.description ?? "").trim().slice(0, 4000) || null,
      kind: normalizeEventKind(b?.kind),
      location: String(b?.location ?? "").trim().slice(0, 200) || null,
      startAt,
      endAt,
      allDay: Boolean(b?.allDay),
      rrule: b?.rrule ? String(b.rrule).trim().slice(0, 300) : null,
      timezone: String(b?.timezone ?? "UTC").trim().slice(0, 64) || "UTC",
      visibility,
      status: normalizeEventStatus(b?.status),
      workspaceId,
      branchId,
      createdById: gate.admin.userId,
      tenantId,
      attendees: {
        create: {
          userId: gate.admin.userId,
          role: "host",
          response: "accepted",
          tenantId,
        },
      },
    },
    select: { id: true },
  });

  return NextResponse.json({ event: { id: event.id } }, { status: 201 });
}
