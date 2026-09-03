import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { canManageWebinar, normalizeAudience, normalizeMode } from "@/lib/work-drive/webinars";

export const dynamic = "force-dynamic";

const SELECT = {
  id: true,
  roomName: true,
  mode: true,
  audience: true,
  registrationRequired: true,
  registrationOpensAt: true,
  registrationClosesAt: true,
  capacity: true,
  landingSlug: true,
  landingConfig: true,
  allowQuestions: true,
  allowChat: true,
  recordAutomatically: true,
  recordingId: true,
  startedAt: true,
  endedAt: true,
  event: {
    select: {
      id: true, title: true, description: true, startAt: true, endAt: true,
      timezone: true, status: true, visibility: true, createdById: true,
      workspace: { select: { members: { select: { userId: true, role: true } } } },
    },
  },
} as const;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const w = await prisma.webinar.findFirst({ where: { id, deletedAt: null }, select: SELECT });
  if (!w) return NextResponse.json({ error: "No such webinar." }, { status: 404 });

  const registrations = await prisma.eventAttendee.findMany({
    where: { eventId: w.event.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, externalName: true, externalEmail: true, response: true, role: true, checkInAt: true, registrationSource: true },
  });
  const staffIds = registrations.map((r) => r.userId).filter(Boolean) as string[];
  const staff = staffIds.length
    ? await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(staff.map((s) => [s.id, s.name]));

  return NextResponse.json({
    webinar: { ...w, event: { ...w.event, workspace: undefined }, canManage: canManageWebinar(w, gate.admin) },
    registrations: registrations.map((r) => ({
      id: r.id,
      name: r.userId ? nameById.get(r.userId) ?? null : r.externalName,
      email: r.externalEmail,
      response: r.response,
      role: r.role,
      checkedIn: Boolean(r.checkInAt),
      source: r.registrationSource,
    })),
  });
}

/** PATCH — config, or start / end the webinar. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const w = await prisma.webinar.findFirst({ where: { id, deletedAt: null }, select: SELECT });
  if (!w) return NextResponse.json({ error: "No such webinar." }, { status: 404 });
  if (!canManageWebinar(w, gate.admin)) {
    return NextResponse.json({ error: "This isn't yours to run." }, { status: 403 });
  }

  const b = await request.json().catch(() => null);
  const data: Record<string, unknown> = {};
  if (b?.mode !== undefined) data.mode = normalizeMode(b.mode);
  if (b?.audience !== undefined) data.audience = normalizeAudience(b.audience);
  if (typeof b?.allowQuestions === "boolean") data.allowQuestions = b.allowQuestions;
  if (typeof b?.allowChat === "boolean") data.allowChat = b.allowChat;
  if (typeof b?.recordAutomatically === "boolean") data.recordAutomatically = b.recordAutomatically;
  if (typeof b?.registrationRequired === "boolean") data.registrationRequired = b.registrationRequired;
  if (b?.capacity !== undefined) data.capacity = Number(b.capacity) > 0 ? Math.floor(Number(b.capacity)) : null;
  if (b?.landingConfig !== undefined) data.landingConfig = b.landingConfig ?? null;
  if (b?.registrationClosesAt !== undefined) data.registrationClosesAt = b.registrationClosesAt ? new Date(b.registrationClosesAt) : null;

  let eventStatus: string | null = null;
  if (b?.action === "start" && !w.startedAt) {
    data.startedAt = new Date();
    eventStatus = "live";
  } else if (b?.action === "end") {
    data.endedAt = new Date();
    eventStatus = "ended";
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.webinar.update({ where: { id }, data });
    if (eventStatus) await tx.workEvent.update({ where: { id: w.event.id }, data: { status: eventStatus } });
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const w = await prisma.webinar.findFirst({ where: { id, deletedAt: null }, select: SELECT });
  if (!w) return NextResponse.json({ ok: true });
  if (!canManageWebinar(w, gate.admin)) {
    return NextResponse.json({ error: "This isn't yours to delete." }, { status: 403 });
  }
  // Deleting the event cascades to the webinar; do both explicitly so the
  // soft-delete guard marks each.
  await prisma.$transaction([
    prisma.webinar.delete({ where: { id } }),
    prisma.workEvent.delete({ where: { id: w.event.id } }),
  ]);
  return NextResponse.json({ ok: true });
}
