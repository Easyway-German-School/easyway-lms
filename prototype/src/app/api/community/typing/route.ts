import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeChannel, canPostInChannel } from "@/lib/community-spaces";

export const dynamic = "force-dynamic";

/**
 * "Someone is typing in this room."
 *
 * The cheapest thing that reads like a real messaging app. There is no stream
 * and no socket — the room is already polling `/api/community/messages` every
 * few seconds, and this rides the same cadence:
 *
 *   POST { channelId }   the client re-stamps its own ping while a draft is
 *                        non-empty, throttled to one call every few seconds.
 *   GET  ?channelId=     the poll asks who has stamped one in the last few
 *                        seconds, and shows their names above the composer.
 *
 * A ping is live for {@link LIVE_MS} past its `updatedAt`. Nothing here is
 * worth keeping: the POST sweeps rows older than {@link STALE_MS} for the same
 * channel on its way through, so a member who closed the tab mid-sentence
 * stops showing without a cron.
 */

/** How long after its last stamp a ping still counts as "typing". */
const LIVE_MS = 7_000;
/** Older than this and the row is swept on the next POST to the channel. */
const STALE_MS = 60_000;

type Viewer = { userId: string; role: string };

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { channelId } = await request.json().catch(() => ({}));
    if (!channelId) {
      return NextResponse.json({ error: "channelId is required" }, { status: 400 });
    }

    const viewer: Viewer = { userId: session.user.id as string, role: (session.user as any).role };

    const channel = await authorizeChannel(viewer, String(channelId));
    if (!channel) {
      return NextResponse.json({ error: "Channel not found in your community" }, { status: 403 });
    }

    // Nobody "types" in an announcement channel — students cannot post there and
    // staff posts are rare and deliberate. Accept the call so the client needs
    // no special-casing, but write nothing.
    if (!canPostInChannel(channel.kind, viewer.role)) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const now = new Date();

    await prisma.typingPing.upsert({
      where: { channelId_userId: { channelId: channel.id, userId: viewer.userId } },
      update: { updatedAt: now },
      create: { channelId: channel.id, userId: viewer.userId },
    });

    // Opportunistic sweep — keeps the table from carrying rows for people who
    // closed the tab three lessons ago, without a scheduled job.
    await prisma.typingPing
      .deleteMany({
        where: { channelId: channel.id, updatedAt: { lt: new Date(now.getTime() - STALE_MS) } },
      })
      .catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Community typing ping error:", error);
    return NextResponse.json({ error: "Unable to update typing state" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const channelId = url.searchParams.get("channelId");
    if (!channelId) {
      return NextResponse.json({ error: "channelId is required" }, { status: 400 });
    }

    const viewer: Viewer = { userId: session.user.id as string, role: (session.user as any).role };

    const channel = await authorizeChannel(viewer, channelId);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found in your community" }, { status: 403 });
    }

    const rows = await prisma.typingPing.findMany({
      where: {
        channelId: channel.id,
        userId: { not: viewer.userId },
        updatedAt: { gt: new Date(Date.now() - LIVE_MS) },
      },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 8,
    });

    return NextResponse.json({
      typers: rows.map((row) => ({
        id: row.user.id,
        // First name only, same as every name shown in the room.
        name: (row.user.name ?? "Someone").trim().split(/\s+/)[0] || "Someone",
      })),
    });
  } catch (error) {
    console.error("Community typing read error:", error);
    return NextResponse.json({ error: "Unable to load typing state" }, { status: 500 });
  }
}
