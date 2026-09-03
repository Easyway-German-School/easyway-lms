import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { canManageWebinar, liveKitReady, mintWebinarToken, type WebinarRole } from "@/lib/work-drive/webinars";

export const dynamic = "force-dynamic";

/**
 * POST — a LiveKit token to join this webinar's room.
 *
 * A manager (or the event host) joins as `host`; a staff attendee as
 * `attendee`. When `recordAutomatically` is on and the host is the one
 * joining, kick the same egress capture the classroom uses.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  if (!liveKitReady()) {
    return NextResponse.json(
      { error: "The live service is not configured on this deployment." },
      { status: 503 },
    );
  }

  const w = await prisma.webinar.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      roomName: true,
      mode: true,
      recordAutomatically: true,
      startedAt: true,
      endedAt: true,
      event: {
        select: {
          id: true, title: true, createdById: true,
          workspace: { select: { members: { select: { userId: true, role: true } } } },
        },
      },
    },
  });
  if (!w) return NextResponse.json({ error: "No such webinar." }, { status: 404 });
  if (w.endedAt) return NextResponse.json({ error: "This webinar has ended." }, { status: 409 });

  const isManager = canManageWebinar(w, gate.admin);
  const role: WebinarRole = isManager ? "host" : "attendee";

  const me = await prisma.user.findUnique({ where: { id: gate.admin.userId }, select: { name: true } });
  const minted = await mintWebinarToken({
    roomName: w.roomName,
    mode: w.mode,
    identity: gate.admin.userId,
    name: me?.name || "Host",
    role,
  });
  if (!minted) return NextResponse.json({ error: "Could not mint a token." }, { status: 500 });

  // Host joining + auto-record on → start the capture, same pipeline as class.
  if (role === "host" && w.recordAutomatically) {
    try {
      const { ensureRecordingStarted } = await import("@/lib/class-recorder");
      const { currentTenantId } = await import("@/lib/tenant/context");
      void ensureRecordingStarted({
        roomName: w.roomName,
        tenantId: currentTenantId(),
        branchId: null,
        branchName: null,
        level: null,
        sessionSlot: null,
        startedByUserId: gate.admin.userId,
        privateClassId: null,
      });
    } catch (e) {
      console.error("webinar: could not start recording", e);
    }
  }

  return NextResponse.json({ ...minted, role, room: w.roomName });
}
