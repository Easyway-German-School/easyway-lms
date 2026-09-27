import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { liveWhere } from "@/lib/live-presence";
import { roomServiceClient } from "@/lib/live-moderation";
import { ATTR_HAND_RAISED_AT } from "@/lib/live-room-protocol";

export const dynamic = "force-dynamic";

/**
 * RAISE OR LOWER A HAND — SERVER-SIDE, NOT SELF-SERVICE.
 *
 * A raised hand used to be the one thing every participant's token was
 * trusted to write about itself: `canUpdateOwnMetadata: true`, so the browser
 * could call `room.localParticipant.setAttributes({ handRaisedAt })` directly.
 * The trouble is LiveKit has no permission bit for "attributes only" — that
 * same grant also unlocks `setMetadata` and `setName` on the client SDK, and
 * `metadata` is the field the whole room-protocol trust model
 * (`roleOfMetadata` in live-room-protocol.ts) and the moderation route both
 * read to decide who is a tutor. A grant meant for one attribute was quietly
 * also a grant to become a tutor by typing one line in devtools.
 *
 * So this is now server-mediated, the same shape as `/api/live/moderate`:
 * the browser asks, the server checks the class is actually live, and only
 * THIS route's own service credentials — never handed to a browser — call
 * LiveKit's admin API to write the one attribute a hand-raise needs. The
 * token minted in `/api/live/session` no longer carries any permission to
 * touch metadata, attributes, or name at all.
 *
 * Deliberately thin: no ownership check beyond "this room is live" and
 * "you are who your session says you are" — a hand-raise cannot end a class,
 * mute anybody, or read anything back, so the blast radius of getting this
 * wrong is one wrong timestamp on one person's own attribute, not a takeover.
 */
export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const roomName = typeof body?.roomName === "string" ? body.roomName.trim() : "";
    const raised = body?.raised === true;

    if (!roomName) {
      return NextResponse.json({ error: "Bad request", message: "Missing room." }, { status: 400 });
    }

    // The room actually has to be live — a hand raised in a room nobody is
    // teaching is not a real event, and this keeps the endpoint from being a
    // free way to prod LiveKit's admin API against an arbitrary string.
    const live = await prisma.liveClassSession.findFirst({
      where: { roomName, ...liveWhere() },
      select: { id: true },
    });
    if (!live) {
      return NextResponse.json({ error: "Not live", message: "That class is not live right now." }, { status: 404 });
    }

    const client = roomServiceClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not configured", message: "The classroom's admin connection is not set up on this deployment." },
        { status: 503 },
      );
    }

    // The identity every participant's token carries is their own user id
    // (see `/api/live/session`) — never taken from the request body, so this
    // can only ever write the CALLER's own attribute, never anyone else's.
    try {
      await client.updateParticipant(roomName, session.user.id, {
        attributes: { [ATTR_HAND_RAISED_AT]: raised ? String(Date.now()) : "" },
      });
    } catch (err) {
      // Most often: they disconnected between the click and this request
      // landing. A hand nobody is in the room to see is not worth a 500.
      console.error("Hand-raise update failed", err);
      return NextResponse.json({ ok: false });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Live hand-raise failed", error);
    return NextResponse.json({ error: "Could not update your hand" }, { status: 500 });
  }
}
