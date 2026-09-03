import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import {
  canEditEvent,
  normalizeEventKind,
  normalizeEventStatus,
  normalizeEventVisibility,
} from "@/lib/work-drive/events";

export const dynamic = "force-dynamic";

const DETAIL_SELECT = {
  id: true,
  title: true,
  description: true,
  kind: true,
  location: true,
  startAt: true,
  endAt: true,
  allDay: true,
  rrule: true,
  timezone: true,
  visibility: true,
  status: true,
  branchId: true,
  workspaceId: true,
  createdById: true,
  createdAt: true,
  workspace: { select: { name: true, slug: true, members: { select: { userId: true, role: true } } } },
} as const;

async function namesFor(ids: (string | null | undefined)[]) {
  const clean = [...new Set(ids.filter(Boolean) as string[])];
  if (clean.length === 0) return new Map<string, string | null>();
  const users = await prisma.user.findMany({ where: { id: { in: clean } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const event = await prisma.workEvent.findFirst({ where: { id, deletedAt: null }, select: DETAIL_SELECT });
  if (!event) return NextResponse.json({ error: "No such event." }, { status: 404 });

  const [attendees, tasks, resources] = await Promise.all([
    prisma.eventAttendee.findMany({
      where: { eventId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, userId: true, externalName: true, externalEmail: true,
        response: true, role: true, checkInAt: true,
      },
    }),
    prisma.eventTask.findMany({
      where: { eventId: id, deletedAt: null },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, assigneeId: true, dueAt: true, done: true, order: true },
    }),
    prisma.eventResource.findMany({
      where: { eventId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, fileId: true, label: true, visibleToAttendees: true,
        file: { select: { name: true, kind: true, sizeBytes: true } },
      },
    }),
  ]);

  const names = await namesFor([
    ...attendees.map((a) => a.userId),
    ...tasks.map((t) => t.assigneeId),
    event.createdById,
  ]);

  return NextResponse.json({
    event: { ...event, members: undefined, canEdit: canEditEvent(event, gate.admin), createdByName: names.get(event.createdById ?? "") ?? null },
    attendees: attendees.map((a) => ({ ...a, name: a.userId ? names.get(a.userId) ?? null : a.externalName })),
    tasks: tasks.map((t) => ({ ...t, assigneeName: t.assigneeId ? names.get(t.assigneeId) ?? null : null })),
    resources: resources.map((r) => ({
      id: r.id,
      fileId: r.fileId,
      label: r.label,
      visibleToAttendees: r.visibleToAttendees,
      name: r.file?.name ?? null,
      kind: r.file?.kind ?? null,
      sizeBytes: r.file ? Number(r.file.sizeBytes) : 0,
    })),
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const event = await prisma.workEvent.findFirst({ where: { id, deletedAt: null }, select: DETAIL_SELECT });
  if (!event) return NextResponse.json({ error: "No such event." }, { status: 404 });
  if (!canEditEvent(event, gate.admin)) {
    return NextResponse.json({ error: "This isn't yours to edit." }, { status: 403 });
  }

  const b = await request.json().catch(() => null);
  const data: Record<string, unknown> = {};
  if (typeof b?.title === "string" && b.title.trim()) data.title = b.title.trim().slice(0, 200);
  if (typeof b?.description === "string") data.description = b.description.trim().slice(0, 4000) || null;
  if (typeof b?.location === "string") data.location = b.location.trim().slice(0, 200) || null;
  if (b?.kind !== undefined) data.kind = normalizeEventKind(b.kind);
  if (b?.visibility !== undefined) data.visibility = normalizeEventVisibility(b.visibility);
  if (b?.status !== undefined) data.status = normalizeEventStatus(b.status);
  if (b?.startAt !== undefined) {
    const d = new Date(b.startAt);
    if (isNaN(d.getTime())) return NextResponse.json({ error: "Bad start time." }, { status: 400 });
    data.startAt = d;
  }
  if (b?.endAt !== undefined) data.endAt = b.endAt ? new Date(b.endAt) : null;
  if (b?.allDay !== undefined) data.allDay = Boolean(b.allDay);
  if (b?.rrule !== undefined) data.rrule = b.rrule ? String(b.rrule).trim().slice(0, 300) : null;
  if (b?.timezone !== undefined) data.timezone = String(b.timezone).trim().slice(0, 64) || "UTC";

  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  await prisma.workEvent.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const event = await prisma.workEvent.findFirst({ where: { id, deletedAt: null }, select: DETAIL_SELECT });
  if (!event) return NextResponse.json({ ok: true });
  if (!canEditEvent(event, gate.admin)) {
    return NextResponse.json({ error: "This isn't yours to delete." }, { status: 403 });
  }
  await prisma.workEvent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
