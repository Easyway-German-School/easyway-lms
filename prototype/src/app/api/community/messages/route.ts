import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeChannel, canPostInChannel, isStaffRole } from "@/lib/community-spaces";
import { activeMuteFor, muteMessage } from "@/lib/community-moderation";
import { markChannelRead } from "@/lib/community-unread";
import { announceChatMessage } from "@/lib/community-notify";

export const dynamic = "force-dynamic";

/** One screenful and a bit. Enough that opening a room never looks empty. */
const PAGE_SIZE = 40;
/** Long enough for a photo caption, short enough to stay a chat. */
const MAX_BODY = 4000;

type Viewer = { userId: string; role: string };

/**
 * The shape a bubble needs, and nothing else.
 *
 * `hiddenAt` is not simply filtered out here — a moderated message still
 * occupies a place in the conversation, and staff have to be able to see what
 * was taken down. So the row is always returned and the BODY is what gets
 * withheld from students. Dropping the row entirely would leave replies quoting
 * a message that appears never to have existed.
 */
function serialise(
  message: {
    id: string;
    body: string;
    authorId: string;
    createdAt: Date;
    editedAt: Date | null;
    hiddenAt: Date | null;
    hiddenReason: string | null;
    attachmentUrl: string | null;
    attachmentType: string | null;
    attachmentName: string | null;
    replyToId: string | null;
    author: { id: string; name: string | null; role: string };
    replyTo?: {
      id: string;
      body: string;
      hiddenAt: Date | null;
      author: { name: string | null };
    } | null;
    reactions?: Array<{ emoji: string; userId: string }>;
    pinnedAt?: Date | null;
  },
  viewer: Viewer,
) {
  const staff = isStaffRole(viewer.role);
  const hidden = Boolean(message.hiddenAt);
  const mine = message.authorId === viewer.userId;

  return {
    id: message.id,
    body: hidden && !staff ? "" : message.body,
    hidden,
    hiddenReason: hidden ? message.hiddenReason : null,
    mine,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    attachment:
      hidden && !staff
        ? null
        : message.attachmentUrl
          ? { url: message.attachmentUrl, type: message.attachmentType, name: message.attachmentName }
          : null,
    author: {
      id: message.author.id,
      name: message.author.name ?? "Someone",
      role: String(message.author.role ?? "").toLowerCase(),
    },
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          author: message.replyTo.author.name ?? "Someone",
          // A quote of a removed message says so rather than repeating it.
          body: message.replyTo.hiddenAt ? "" : message.replyTo.body.slice(0, 180),
          hidden: Boolean(message.replyTo.hiddenAt),
        }
      : null,
    /**
     * Folded to one entry per emoji, carrying whether THIS reader is in it.
     *
     * `mine` is what lets the pill be a toggle rather than a counter: the
     * client needs to know, without another request, whether tapping will add
     * or remove. Sending the raw rows would leak who reacted to what across a
     * whole cohort for no gain — the bubble only ever shows the count.
     */
    reactions: foldReactions(message.reactions ?? [], viewer.userId),
    pinned: Boolean(message.pinnedAt),
  };
}

function foldReactions(rows: Array<{ emoji: string; userId: string }>, viewerId: string) {
  const byEmoji = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const row of rows) {
    const entry = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false };
    entry.count += 1;
    if (row.userId === viewerId) entry.mine = true;
    byEmoji.set(row.emoji, entry);
  }
  // Most-reacted first, so the bubble reads like every other chat app.
  return [...byEmoji.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

const INCLUDE = {
  author: { select: { id: true, name: true, role: true } },
  replyTo: { select: { id: true, body: true, hiddenAt: true, author: { select: { name: true } } } },
  reactions: { select: { emoji: true, userId: true } },
} as const;

/**
 * GET /api/community/messages?channelId=…
 *
 * Three jobs behind one route, chosen by which cursor is supplied:
 *
 *   (none)        the newest page — what opening a room asks for
 *   ?after=<id>   anything since this message — what the poll asks for
 *   ?before=<id>  the page above — what scrolling up asks for
 *
 * `after` is the hot path: every open chat hits it every few seconds, so it is
 * a single indexed range scan on `[channelId, createdAt]` and returns an empty
 * array almost every time.
 */
export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const channelId = url.searchParams.get("channelId");
    if (!channelId) return NextResponse.json({ error: "channelId is required" }, { status: 400 });

    const viewer: Viewer = { userId: session.user.id as string, role: (session.user as any).role };
    const channel = await authorizeChannel(viewer, channelId);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found in your community" }, { status: 403 });
    }

    const after = url.searchParams.get("after");
    const before = url.searchParams.get("before");

    /**
     * Cursors are message ids, resolved to their timestamp here.
     *
     * Not raw timestamps from the client: two messages can share a millisecond,
     * and a timestamp cursor either loses one of them or delivers it twice. An
     * id is exact, and resolving it server-side means a client cannot ask for
     * messages in a channel it cannot read by fabricating a cursor.
     */
    const cursorId = after ?? before;
    const cursor = cursorId
      ? await prisma.message.findFirst({
          where: { id: cursorId, channelId: channel.id },
          select: { createdAt: true },
        })
      : null;

    if (after) {
      const rows = await prisma.message.findMany({
        where: { channelId: channel.id, ...(cursor ? { createdAt: { gt: cursor.createdAt } } : {}) },
        include: INCLUDE,
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      return NextResponse.json({ messages: rows.map((row) => serialise(row, viewer)), mode: "after" });
    }

    // Newest-first from the database so the cursor works, then flipped: the UI
    // renders oldest at the top like every chat anybody has used.
    const rows = await prisma.message.findMany({
      where: { channelId: channel.id, ...(cursor ? { createdAt: { lt: cursor.createdAt } } : {}) },
      include: INCLUDE,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE + 1,
    });

    const hasMore = rows.length > PAGE_SIZE;
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    /**
     * Pinned messages come back SEPARATELY from the page.
     *
     * A pin is worth nothing if it scrolls away with everything else — the
     * point of pinning "the exam is on the 14th" is that it is still on screen
     * on the 13th, by which time it is four hundred messages back and not in
     * any page the client has loaded.
     */
    const pinned = await prisma.message.findMany({
      where: { channelId: channel.id, pinnedAt: { not: null }, hiddenAt: null },
      include: INCLUDE,
      orderBy: { pinnedAt: "desc" },
      take: 3,
    });

    const mute = await activeMuteFor(viewer.userId);

    return NextResponse.json({
      messages: page.reverse().map((row) => serialise(row, viewer)),
      pinned: pinned.map((row) => serialise(row, viewer)),
      hasMore,
      // Muted students get the composer disabled AND the reason, so a silence
      // is never unexplained. The send path re-checks; this is presentation.
      canPost: canPostInChannel(channel.kind, viewer.role) && !mute,
      mutedUntil: mute?.mutedUntil ?? null,
      muteReason: mute ? muteMessage(mute) : null,
      canModerate: isStaffRole(viewer.role),
      mode: before ? "before" : "initial",
    });
  } catch (error) {
    console.error("Community messages read error:", error);
    return NextResponse.json({ error: "Unable to load messages" }, { status: 500 });
  }
}

/** POST /api/community/messages — say something. */
export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const channelId = String(body.channelId ?? "");
    const text = String(body.body ?? "").trim().slice(0, MAX_BODY);
    const attachmentUrl = body.attachmentUrl ? String(body.attachmentUrl) : null;

    if (!channelId) return NextResponse.json({ error: "channelId is required" }, { status: 400 });
    // A message with neither words nor a picture is not a message.
    if (!text && !attachmentUrl) {
      return NextResponse.json({ error: "Type something first" }, { status: 400 });
    }

    const viewer: Viewer = { userId: session.user.id as string, role: (session.user as any).role };
    const channel = await authorizeChannel(viewer, channelId);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found in your community" }, { status: 403 });
    }

    /**
     * Announcements are read-only for students, checked HERE and not only in
     * the UI. Hiding the composer stops the honest route in; this stops the
     * other one, and "the tutor's announcement channel" is exactly the place a
     * student posting would do the most damage to how the room reads.
     */
    if (!canPostInChannel(channel.kind, viewer.role)) {
      return NextResponse.json(
        { error: "Only your tutor and the office can post in Announcements." },
        { status: 403 },
      );
    }

    /**
     * A muted student, checked on the send itself.
     *
     * Disabling the composer is a courtesy to the honest reader; this is what
     * actually holds. A mute that only hid the text box would be lifted by
     * anybody willing to POST to the endpoint — which, in a room full of
     * teenagers who have just watched a classmate get muted, is not a
     * hypothetical.
     */
    const mute = await activeMuteFor(viewer.userId);
    if (mute) {
      return NextResponse.json({ error: muteMessage(mute), mutedUntil: mute.mutedUntil }, { status: 403 });
    }

    // A quote must point at a message in THIS channel — otherwise a crafted id
    // would pull a line out of another cohort's room and render it here.
    let replyToId: string | null = null;
    if (body.replyToId) {
      const quoted = await prisma.message.findFirst({
        where: { id: String(body.replyToId), channelId: channel.id },
        select: { id: true },
      });
      replyToId = quoted?.id ?? null;
    }

    const created = await prisma.message.create({
      data: {
        channelId: channel.id,
        authorId: viewer.userId,
        body: text,
        replyToId,
        attachmentUrl,
        attachmentType: body.attachmentType ? String(body.attachmentType) : null,
        attachmentName: body.attachmentName ? String(body.attachmentName) : null,
      },
      include: INCLUDE,
    });

    // Your own message must never leave a badge on your own sidebar.
    await markChannelRead(viewer.userId, channel.id);

    /**
     * Tell the rest of the room, on their phones and on whatever page of the
     * portal they happen to be on. Fire-and-forget: a notification service
     * having a bad minute must not fail somebody's message.
     */
    announceChatMessage({
      channelId: channel.id,
      channelName: channel.name,
      spaceId: channel.spaceId,
      messageId: created.id,
      authorId: viewer.userId,
      authorName: created.author.name ?? "Someone",
      body: text,
      hasAttachment: Boolean(attachmentUrl),
    });

    return NextResponse.json({ message: serialise(created, viewer) }, { status: 201 });
  } catch (error) {
    console.error("Community message send error:", error);
    return NextResponse.json({ error: "Unable to send your message" }, { status: 500 });
  }
}
