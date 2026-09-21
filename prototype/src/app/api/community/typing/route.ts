import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { authorizeChannel, canPostInChannel } from "@/lib/community-spaces";
import { clearTyping, stampTyping, typersInChannel } from "@/lib/community-typing";

export const dynamic = "force-dynamic";

/**
 * "Someone is typing in this room."
 *
 * The cheapest thing that reads like a real messaging app. There is no stream
 * and no socket — the room is already polling, and this rides the same idea:
 *
 *   POST { channelId }                  the client re-stamps its own ping while
 *                                       a draft is non-empty, throttled.
 *   POST { channelId, typing: false }   "I stopped" — box emptied, message sent.
 *   GET  ?channelId=                    who has stamped one in the last few
 *                                       seconds, for the room the viewer has open.
 *
 * The portal-wide "somebody is typing in one of your rooms" pill reads
 * /api/community/typing/feed instead. The model both share — stamp, live
 * window, no expiry job — is written up in lib/typing.ts.
 */

type Viewer = { userId: string; role: string };

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { channelId, typing } = await request.json().catch(() => ({}));
    if (!channelId) {
      return NextResponse.json({ error: "channelId is required" }, { status: 400 });
    }

    const viewer: Viewer = { userId: session.user.id as string, role: (session.user as any).role };

    const channel = await authorizeChannel(viewer, String(channelId));
    if (!channel) {
      return NextResponse.json({ error: "Channel not found in your community" }, { status: 403 });
    }

    if (typing === false) {
      await clearTyping(channel.id, viewer.userId);
      return NextResponse.json({ ok: true });
    }

    // Nobody "types" in an announcement channel — students cannot post there and
    // staff posts are rare and deliberate. Accept the call so the client needs
    // no special-casing, but write nothing.
    if (!canPostInChannel(channel.kind, viewer.role)) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    await stampTyping(channel.id, viewer.userId);
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

    return NextResponse.json({ typers: await typersInChannel(channel.id, viewer.userId) });
  } catch (error) {
    console.error("Community typing read error:", error);
    return NextResponse.json({ error: "Unable to load typing state" }, { status: 500 });
  }
}
