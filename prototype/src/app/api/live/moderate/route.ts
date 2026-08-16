import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lecturerCan } from "@/lib/lecturer-features";
import { liveWhere } from "@/lib/live-presence";
import {
  muteAllStudents,
  muteParticipantMic,
  removeParticipantFromRoom,
  roomServiceClient,
} from "@/lib/live-moderation";

export const dynamic = "force-dynamic";

type ModerateAction = "mute" | "muteAll" | "remove";
const ACTIONS: ModerateAction[] = ["mute", "muteAll", "remove"];

/**
 * The server side of the tutor's `roomAdmin` grant.
 *
 * The token minted in `/api/live/session` has claimed since day one that "only
 * a tutor can mute others, remove a participant, or end the class" — this is
 * where that claim is actually enforced, rather than merely a permission
 * nobody exercises. Every action here is checked twice: once for whether the
 * caller is a tutor at all, and once for whether they are THIS room's tutor —
 * a tutor teaching one class has no business muting a different one.
 */
export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const roomName = typeof body?.roomName === "string" ? body.roomName.trim() : "";
    const action = typeof body?.action === "string" ? (body.action as ModerateAction) : null;
    const identity = typeof body?.identity === "string" ? body.identity.trim() : null;

    if (!roomName || !action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Bad request", message: "Missing or invalid room/action." }, { status: 400 });
    }
    if ((action === "mute" || action === "remove") && !identity) {
      return NextResponse.json({ error: "Bad request", message: "This action needs who to target." }, { status: 400 });
    }

    const isAdmin = String(session.user.role ?? "").toLowerCase() === "admin";
    const lecturer = await prisma.lecturer.findUnique({ where: { userId: session.user.id } });

    if (!isAdmin) {
      if (!lecturer) {
        return NextResponse.json({ error: "Forbidden", message: "Only a tutor can do this." }, { status: 403 });
      }
      if (!lecturerCan(lecturer.features, "live_classes")) {
        return NextResponse.json(
          { error: "Forbidden", message: "The school has not given you live classes." },
          { status: 403 },
        );
      }
    }

    /**
     * OWNERSHIP, NOT JUST ROLE.
     *
     * `roomAdmin` on a token is a claim about the ROLE, not about which room —
     * a tutor's own token is scoped to their own room by `roomJoin`, but this
     * endpoint takes a room name in the request body, and a body is not a
     * token. Without this lookup, a tutor teaching one cohort could quote
     * another cohort's room name and mute a class they have never taught.
     */
    if (!isAdmin) {
      const owns = await prisma.liveClassSession.findFirst({
        where: { roomName, lecturerId: lecturer!.id, ...liveWhere() },
        select: { id: true },
      });
      if (!owns) {
        return NextResponse.json(
          { error: "Not your class", message: "That live class is not one you are teaching right now." },
          { status: 403 },
        );
      }
    }

    const client = roomServiceClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not configured", message: "The classroom's admin connection is not set up on this deployment." },
        { status: 503 },
      );
    }

    if (action === "mute" || action === "remove") {
      // The caller's own identity is always allowed to leave by the normal
      // Leave button; it is never a valid target for a moderation action.
      if (identity === session.user.id) {
        return NextResponse.json(
          { error: "Bad request", message: "You cannot target yourself." },
          { status: 400 },
        );
      }

      let target;
      try {
        target = await client.getParticipant(roomName, identity!);
      } catch {
        return NextResponse.json(
          { error: "Not found", message: "That person is not in the room anymore." },
          { status: 404 },
        );
      }

      // A tutor's mic and seat are not another tutor's to touch — only staff
      // running the platform get to moderate a co-teacher.
      let targetIsTutor = false;
      try {
        targetIsTutor = JSON.parse(target.metadata || "{}")?.role === "tutor";
      } catch {
        targetIsTutor = false;
      }
      if (targetIsTutor && !isAdmin) {
        return NextResponse.json(
          { error: "Forbidden", message: "You cannot moderate another tutor." },
          { status: 403 },
        );
      }
    }

    switch (action) {
      case "mute": {
        const muted = await muteParticipantMic(client, roomName, identity!);
        return NextResponse.json({ ok: true, muted });
      }
      case "muteAll": {
        const identities = await muteAllStudents(client, roomName, session.user.id);
        return NextResponse.json({ ok: true, muted: identities });
      }
      case "remove": {
        await removeParticipantFromRoom(client, roomName, identity!);
        return NextResponse.json({ ok: true });
      }
    }
  } catch (error) {
    console.error("Live moderation action failed", error);
    return NextResponse.json({ error: "Could not complete that action" }, { status: 500 });
  }
}
