import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSpaceScope } from "@/lib/community-spaces";
import { unreadByChannel, totalUnread } from "@/lib/community-unread";
import { previewOf } from "@/lib/community-notify";

export const dynamic = "force-dynamic";

/**
 * EVERYTHING THAT SHOULD INTERRUPT SOMEBODY, IN ONE POLL.
 *
 * This exists because the portal had no way to tell a student something while
 * they were looking at a different page. Chat lived on /community, the bell
 * lived in the shell header and only updated on navigation, and the result was
 * that a tutor's message reached a student when they next happened to open the
 * right screen — which for most students is never.
 *
 * One endpoint rather than three, and that is a deliberate cost decision. This
 * is polled by every signed-in browser on every page for the whole time the
 * portal is open. Three endpoints would be three sets of auth, three tenant
 * resolutions and three round trips on connections that cannot spare one.
 *
 * WHY POLLING AND NOT SSE. Server-sent events would be the elegant answer and
 * are the wrong one here: this deploys to Vercel, where a function has a hard
 * execution ceiling, so a held-open stream is killed and reconnected on a timer
 * anyway — polling with extra steps, and worse failure modes on a flaky mobile
 * link. A cheap indexed query every few seconds is honest about what it is.
 *
 * The client sends `since`, the timestamp it last heard about. Everything newer
 * comes back WITH ITS TEXT — the entire point of the feature is that the popup
 * shows what was actually said, so a payload of ids and counts would miss it.
 */

/** A hard cap, so a browser left closed over a weekend does not get a wall. */
const MAX_ITEMS = 8;

export type PortalUpdate = {
  id: string;
  source: "chat" | "notification";
  title: string;
  body: string;
  link: string | null;
  at: string;
  severity: string;
  author: { name: string } | null;
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  // Signed out is not an error worth logging — it is a tab somebody left open.
  if (!session?.user?.id) return NextResponse.json({ updates: [], unread: 0, now: new Date().toISOString() });

  const userId = session.user.id as string;
  const now = new Date();

  try {
    const sinceParam = request.url ? new URL(request.url).searchParams.get("since") : null;
    const parsed = sinceParam ? new Date(sinceParam) : null;

    /**
     * A missing or absurd cursor means "start from now", never "start from the
     * beginning". A first page load must not replay the term's backlog as
     * popups, and a clock-skewed phone must not either — which is why the
     * cursor is also clamped to the last hour.
     */
    const floor = new Date(now.getTime() - 60 * 60_000);
    const since =
      parsed && !Number.isNaN(parsed.getTime()) ? new Date(Math.max(parsed.getTime(), floor.getTime())) : now;

    const scope = await resolveSpaceScope({ userId, role: (session.user as any).role });

    const channels = scope.spaceIds.length
      ? await prisma.channel.findMany({
          where: { spaceId: { in: scope.spaceIds } },
          select: { id: true, name: true },
        })
      : [];
    const channelName = new Map(channels.map((c) => [c.id, c.name]));

    const [messages, notifications, unread] = await Promise.all([
      channels.length
        ? prisma.message.findMany({
            where: {
              channelId: { in: channels.map((c) => c.id) },
              createdAt: { gt: since },
              hiddenAt: null,
              // Never pop up somebody's own message back at them.
              authorId: { not: userId },
            },
            include: { author: { select: { name: true } } },
            orderBy: { createdAt: "desc" },
            take: MAX_ITEMS,
          })
        : Promise.resolve([]),

      /**
       * The bell's own rows, so a payment warning or a "your class is live"
       * interrupts from any page too. Only unread ones: a notification the
       * student has already dealt with must not come back as a popup.
       */
      prisma.notification.findMany({
        where: {
          userId,
          channel: "in-app",
          readAt: null,
          createdAt: { gt: since },
        },
        orderBy: { createdAt: "desc" },
        take: MAX_ITEMS,
      }),

      channels.length
        ? unreadByChannel(userId, channels.map((c) => c.id))
        : Promise.resolve({} as Record<string, number>),
    ]);

    const updates: PortalUpdate[] = [
      ...messages.map((message) => ({
        id: `chat:${message.id}`,
        source: "chat" as const,
        title: `${message.author.name ?? "Someone"} · ${channelName.get(message.channelId) ?? "Community"}`,
        body: previewOf(message.body, Boolean(message.attachmentUrl)),
        link: `/community?channel=${message.channelId}&message=${message.id}`,
        at: message.createdAt.toISOString(),
        severity: "info",
        author: { name: message.author.name ?? "Someone" },
      })),
      ...notifications.map((notification) => ({
        id: `notification:${notification.id}`,
        source: "notification" as const,
        title: notification.title,
        body: notification.message,
        link: notification.link,
        at: notification.createdAt.toISOString(),
        severity: notification.severity,
        author: null,
      })),
    ]
      // Newest first, then capped: on a busy morning the student sees the most
      // recent handful rather than a stack they have to dismiss one at a time.
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_ITEMS);

    return NextResponse.json({
      updates,
      unread: totalUnread(unread),
      // The client echoes this back as `since`, so the window is defined by the
      // server's clock throughout. A phone with the wrong time cannot then miss
      // messages or replay them.
      now: now.toISOString(),
    });
  } catch (error) {
    console.error("Portal updates poll failed:", error);
    // Deliberately a 200 with nothing in it. This runs on a timer forever; a
    // 500 here would fill the console of every open tab in the school.
    return NextResponse.json({ updates: [], unread: 0, now: now.toISOString() });
  }
}
