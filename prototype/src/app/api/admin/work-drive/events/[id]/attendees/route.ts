import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { canEditEvent } from "@/lib/work-drive/events";
import { notify, KIND } from "@/lib/notify";

export const dynamic = "force-dynamic";

const EVT_SELECT = {
  id: true,
  title: true,
  startAt: true,
  createdById: true,
  workspace: { select: { members: { select: { userId: true, role: true } } } },
} as const;

/** POST — invite a staff member by email, or add an external guest. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const event = await prisma.workEvent.findFirst({ where: { id, deletedAt: null }, select: EVT_SELECT });
  if (!event) return NextResponse.json({ error: "No such event." }, { status: 404 });
  if (!canEditEvent(event, gate.admin)) {
    return NextResponse.json({ error: "This isn't yours to edit." }, { status: 403 });
  }

  const b = await request.json().catch(() => null);
  const email = String(b?.email ?? "").trim().toLowerCase();
  const role = ["host", "co_host", "presenter", "attendee"].includes(String(b?.role)) ? String(b.role) : "attendee";
  const tenantId = gate.session.user.tenantId ?? null;

  const staff = email
    ? await prisma.user.findFirst({ where: { email }, select: { id: true, name: true, role: true } })
    : null;

  if (staff && String(staff.role).toLowerCase() !== "student") {
    const a = await prisma.eventAttendee.upsert({
      where: { eventId_userId: { eventId: id, userId: staff.id } },
      create: { eventId: id, userId: staff.id, role, response: "invited", tenantId },
      update: { role },
      select: { id: true },
    });
    await notify({
      to: { userIds: [staff.id] },
      title: `Invited: ${event.title}`,
      message: `You've been added to "${event.title}".`,
      kind: KIND.general,
      link: `/admin/calendar`,
      senderId: gate.admin.userId,
    }).catch(() => {});
    return NextResponse.json({ attendee: { id: a.id, name: staff.name, role } });
  }

  // External guest.
  const name = String(b?.name ?? "").trim().slice(0, 120);
  if (!email) return NextResponse.json({ error: "An email is required." }, { status: 400 });
  const guest = await prisma.eventAttendee.upsert({
    where: { eventId_externalEmail: { eventId: id, externalEmail: email } },
    create: { eventId: id, externalEmail: email, externalName: name || null, role, registrationSource: "manual", tenantId },
    update: { externalName: name || null, role },
    select: { id: true },
  });
  return NextResponse.json({ attendee: { id: guest.id, name: name || email, role } });
}

/** PATCH ?attendeeId= — set RSVP response or check someone in. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const event = await prisma.workEvent.findFirst({ where: { id, deletedAt: null }, select: EVT_SELECT });
  if (!event) return NextResponse.json({ error: "No such event." }, { status: 404 });

  const b = await request.json().catch(() => null);
  const attendeeId = String(b?.attendeeId ?? "").trim();
  const attendee = await prisma.eventAttendee.findFirst({
    where: { id: attendeeId, eventId: id },
    select: { id: true, userId: true },
  });
  if (!attendee) return NextResponse.json({ error: "Not on this event." }, { status: 404 });

  const isSelf = attendee.userId === gate.admin.userId;
  const canManage = canEditEvent(event, gate.admin);
  if (!isSelf && !canManage) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const data: Record<string, unknown> = {};
  if (["accepted", "declined", "tentative", "invited", "attended", "no_show"].includes(String(b?.response))) {
    data.response = String(b.response);
  }
  if (b?.checkIn === true && canManage) {
    data.checkInAt = new Date();
    data.response = "attended";
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  await prisma.eventAttendee.update({ where: { id: attendeeId }, data });
  return NextResponse.json({ ok: true });
}

/** DELETE ?attendeeId= — remove someone. Managers only. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const event = await prisma.workEvent.findFirst({ where: { id, deletedAt: null }, select: EVT_SELECT });
  if (!event) return NextResponse.json({ ok: true });
  if (!canEditEvent(event, gate.admin)) {
    return NextResponse.json({ error: "This isn't yours to edit." }, { status: 403 });
  }
  const attendeeId = new URL(request.url).searchParams.get("attendeeId") || "";
  await prisma.eventAttendee.deleteMany({ where: { id: attendeeId, eventId: id } });
  return NextResponse.json({ ok: true });
}
