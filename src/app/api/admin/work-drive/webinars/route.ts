import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { normalizeEventVisibility } from "@/lib/work-drive/events";
import { normalizeAudience, normalizeMode, uniqueLandingSlug, webinarRoomName } from "@/lib/work-drive/webinars";

export const dynamic = "force-dynamic";

/** GET — webinars this admin can see, upcoming first. */
export async function GET() {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;

  const rows = await prisma.webinar.findMany({
    where: { deletedAt: null },
    orderBy: { event: { startAt: "desc" } },
    select: {
      id: true,
      mode: true,
      audience: true,
      landingSlug: true,
      startedAt: true,
      endedAt: true,
      registrationRequired: true,
      event: {
        select: {
          id: true, title: true, startAt: true, endAt: true, status: true,
          _count: { select: { attendees: true } },
        },
      },
    },
  });

  return NextResponse.json({
    webinars: rows.map((w) => ({
      id: w.id,
      title: w.event.title,
      startAt: w.event.startAt,
      endAt: w.event.endAt,
      status: w.event.status,
      mode: w.mode,
      audience: w.audience,
      landingSlug: w.landingSlug,
      live: Boolean(w.startedAt && !w.endedAt),
      registrations: w.event._count.attendees,
    })),
  });
}

/** POST — create a webinar (its WorkEvent + the Webinar row + a room name). */
export async function POST(request: NextRequest) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const tenantId = gate.session.user.tenantId ?? null;
  if (!tenantId) return NextResponse.json({ error: "This account has no calendar." }, { status: 400 });

  const b = await request.json().catch(() => null);
  const title = String(b?.title ?? "").trim();
  if (!title || title.length > 200) {
    return NextResponse.json({ error: "Give the webinar a title." }, { status: 400 });
  }
  const startAt = new Date(b?.startAt);
  if (isNaN(startAt.getTime())) return NextResponse.json({ error: "A start time is required." }, { status: 400 });
  const endAt = b?.endAt ? new Date(b.endAt) : null;

  const mode = normalizeMode(b?.mode);
  const audience = normalizeAudience(b?.audience);
  const isPublic = audience === "public";
  const landingSlug = isPublic ? await uniqueLandingSlug(title) : null;
  const eventVisibility = isPublic ? "public" : normalizeEventVisibility(b?.visibility ?? "staff");

  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.workEvent.create({
      data: {
        title,
        description: String(b?.description ?? "").trim().slice(0, 4000) || null,
        kind: "webinar",
        location: "Online",
        startAt,
        endAt,
        timezone: String(b?.timezone ?? "UTC").trim().slice(0, 64) || "UTC",
        visibility: eventVisibility,
        status: "scheduled",
        createdById: gate.admin.userId,
        tenantId,
        attendees: { create: { userId: gate.admin.userId, role: "host", response: "accepted", tenantId } },
      },
      select: { id: true },
    });

    // roomName needs the webinar id, so create then patch.
    const webinar = await tx.webinar.create({
      data: {
        eventId: event.id,
        roomName: `pending_${event.id}`,
        mode,
        audience,
        registrationRequired: b?.registrationRequired !== false,
        capacity: Number.isFinite(Number(b?.capacity)) && Number(b?.capacity) > 0 ? Math.floor(Number(b.capacity)) : null,
        landingSlug,
        landingConfig: b?.landingConfig ?? null,
        recordAutomatically: b?.recordAutomatically !== false,
        tenantId,
      },
      select: { id: true },
    });
    await tx.webinar.update({ where: { id: webinar.id }, data: { roomName: webinarRoomName(webinar.id) } });
    return { id: webinar.id, landingSlug };
  });

  return NextResponse.json({ webinar: created }, { status: 201 });
}
