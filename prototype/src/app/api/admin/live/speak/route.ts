import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { requireCapability } from "@/lib/admin-roles";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { liveWhere } from "@/lib/live-presence";
import { ANNOUNCE_DISPLAY_NAME, announceIdentity, missingLiveKitConfig } from "@/lib/live-classroom";

export const dynamic = "force-dynamic";

/**
 * A TOKEN FOR SPEAKING TO A LIVE CLASS WITHOUT BEING NAMED.
 *
 * The sibling of `/api/admin/live/observe`, and deliberately the opposite
 * shape. Silent supervision is `hidden: true` because the whole point is that
 * nobody ever knows the office looked in. This is `hidden: false` because the
 * whole point here is the reverse: the class needs to actually see a face or
 * hear a voice, or there is no way to pass an urgent message across. What
 * stays hidden is not the presence — it's the person.
 *
 *   hidden: false        — LiveKit announces this join like any other. The
 *                          class sees "The Office" connect, speak, and leave.
 *   name: "The Office"   — never the admin's own name. Every admin who ever
 *                          uses this connects under the same fixed label, so
 *                          which staff member it was is not recoverable from
 *                          anything the room itself shows.
 *   canPublish: true     — camera and microphone, unlike the observer token.
 *                          The class is meant to hear this.
 *   role: "admin"        — lets the classroom protocol (live-room-protocol.ts)
 *                          accept the "an announcement is coming" signal from
 *                          this connection and no other, and lets the
 *                          moderation route (live-moderation.ts) refuse to let
 *                          a tutor mute or remove it.
 *
 * Not deduped like the observer's audit line: a second announcement in the
 * same class ten minutes later is exactly as real an event as the first one,
 * not a reopened panel.
 */
export async function GET(request: NextRequest) {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;
  const { admin } = gate;

  const roomName = request.nextUrl.searchParams.get("room");
  if (!roomName) {
    return NextResponse.json({ error: "Which class? Pass ?room=" }, { status: 400 });
  }

  const session = await prisma.liveClassSession.findFirst({
    where: { roomName, ...liveWhere() },
    orderBy: { startedAt: "desc" },
    select: { id: true, title: true, roomName: true, branchId: true },
  });
  if (!session) {
    return NextResponse.json({ error: "That class is not live." }, { status: 404 });
  }

  if (admin.branchIds && session.branchId && !admin.branchIds.includes(session.branchId)) {
    return NextResponse.json(
      { error: "That class is at a branch your account does not cover." },
      { status: 403 },
    );
  }

  const missing = missingLiveKitConfig();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `The live classroom is not configured on this deployment — missing ${missing.join(", ")}.` },
      { status: 503 },
    );
  }

  const token = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity: announceIdentity(admin.userId),
    name: ANNOUNCE_DISPLAY_NAME,
    // Short — this is a brief interruption to say something, not a seat to
    // hold for the rest of the lesson. An admin who needs longer reconnects.
    ttl: "45m",
    metadata: JSON.stringify({ role: "admin" }),
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: false,
    hidden: false,
    roomAdmin: false,
  });

  await writeAudit(unguardedPrisma, {
    action: "liveAnnounce",
    model: "LiveClassSession",
    recordId: session.id,
    severity: "notice",
    summary: `Spoke anonymously as "${ANNOUNCE_DISPLAY_NAME}" in "${session.title}"`,
  });

  return NextResponse.json({
    url: process.env.LIVEKIT_URL,
    token: await token.toJwt(),
    roomName: session.roomName,
    title: session.title,
  });
}
