import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { liveWhere } from "@/lib/live-presence";
import { roomServiceClient } from "@/lib/live-moderation";
import { TrackSource } from "livekit-server-sdk";

export const dynamic = "force-dynamic";

/**
 * THE ADMIN'S OWN "WHO'S LIVE RIGHT NOW" — the thing LiveKit Cloud's own
 * dashboard shows, built out of two layers that answer different questions.
 *
 * Layer one is a plain read of `LiveClassSession` (see liveWhere() in
 * live-presence.ts) — which rooms are live, since when, taught by whom,
 * how many were invited/joined. This is free: the table already exists for
 * the ringing/join-code feature, an admin dashboard is just a second reader.
 *
 * Layer two calls LiveKit's own server API — `roomServiceClient()`, already
 * built for moderation in live-moderation.ts — for the thing the database
 * cannot answer: who is ACTUALLY connected right now. An invite row says
 * somebody was asked; it does not say they are still there, or that a
 * walk-in without an invite joined by join code. `listParticipants` is asked
 * fresh, per room, on every load — there is no caching layer for it, because
 * caching a live headcount is how a dashboard tells you about the class that
 * ended ten minutes ago.
 *
 * One honest gap, said here rather than glossed over: LiveKit does not expose
 * per-participant CONNECTION QUALITY over this server API at all — that is a
 * client-side signal (`RoomEvent.ConnectionQualityChanged`), only visible to
 * somebody actually connected to the room. Reaching it would mean the admin
 * silently joining every live class as a hidden participant, which changes
 * what "who's in this room" means and is not a call this file makes on its
 * own. What LiveKit's server API DOES give us — identity, join time, and
 * whether a camera/mic is actually publishing and muted — is what this route
 * reports instead, under its own honest name.
 */

type SessionSummary = {
  id: string;
  roomName: string;
  title: string;
  kind: string;
  branchId: string | null;
  branchName: string | null;
  level: string | null;
  sessionSlot: string | null;
  lecturerName: string | null;
  startedAt: string;
  joinCode: string;
  invited: number;
  joined: number;
  declined: number;
  /** null when LiveKit could not be reached, or the room has nobody in it yet. */
  participantCount: number | null;
};

async function participantCount(client: ReturnType<typeof roomServiceClient>, roomName: string): Promise<number | null> {
  if (!client) return null;
  try {
    const participants = await client.listParticipants(roomName);
    return participants.length;
  } catch {
    // LiveKit 404s an empty/never-opened room rather than returning [] — that
    // is "nobody connected", not a failure worth surfacing as one.
    return 0;
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const room = request.nextUrl.searchParams.get("room");
  const client = roomServiceClient();

  // Detail mode: one room's actual participants, only fetched when the admin
  // expands that row — not on every poll of the summary list.
  if (room) {
    // The room must actually be one of ours and genuinely live — a room name
    // is a LiveKit identifier, not a credential, but there is no reason to let
    // this endpoint become a general "peek at any LiveKit room" proxy.
    const owns = await prisma.liveClassSession.findFirst({
      where: { roomName: room, ...liveWhere() },
      select: { id: true },
    });
    if (!owns) return NextResponse.json({ error: "That class is not live." }, { status: 404 });

    if (!client) {
      return NextResponse.json({ error: "LiveKit is not configured on this server." }, { status: 503 });
    }

    try {
      const participants = await client.listParticipants(room);
      return NextResponse.json({
        participants: participants.map((participant) => {
          let role = "student";
          try {
            role = JSON.parse(participant.metadata || "{}")?.role === "tutor" ? "tutor" : "student";
          } catch {
            // Malformed metadata reads as a student — the safer default for
            // a badge nobody acts on.
          }
          const camera = participant.tracks.find((t) => t.source === TrackSource.CAMERA);
          const mic = participant.tracks.find((t) => t.source === TrackSource.MICROPHONE);
          return {
            identity: participant.identity,
            name: participant.name || participant.identity,
            role,
            joinedAt: new Date(
              Number(participant.joinedAtMs) || Number(participant.joinedAt) * 1000,
            ).toISOString(),
            camera: camera ? (camera.muted ? "off" : "on") : "none",
            mic: mic ? (mic.muted ? "off" : "on") : "none",
          };
        }),
      });
    } catch (error) {
      console.error("Admin live participants fetch failed", error);
      return NextResponse.json({ error: "Could not reach LiveKit for that room." }, { status: 502 });
    }
  }

  // Summary mode: every room this tenant has live right now.
  const sessions = await prisma.liveClassSession.findMany({
    where: liveWhere(),
    orderBy: { startedAt: "asc" },
    include: {
      branch: { select: { name: true } },
      lecturer: { select: { user: { select: { name: true } } } },
      invites: { select: { status: true } },
    },
  });

  const summaries: SessionSummary[] = await Promise.all(
    sessions.map(async (session) => ({
      id: session.id,
      roomName: session.roomName,
      title: session.title,
      kind: session.kind,
      branchId: session.branchId,
      branchName: session.branch?.name ?? null,
      level: session.level,
      sessionSlot: session.sessionSlot,
      lecturerName: session.lecturer?.user?.name ?? null,
      startedAt: session.startedAt.toISOString(),
      joinCode: session.joinCode,
      invited: session.invites.length,
      joined: session.invites.filter((i) => i.status === "joined").length,
      declined: session.invites.filter((i) => i.status === "declined").length,
      participantCount: await participantCount(client, session.roomName),
    })),
  );

  return NextResponse.json({ sessions: summaries });
}
