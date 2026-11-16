/**
 * EVERYTHING THAT SHOULD INTERRUPT SOMEBODY, IN ONE QUERY.
 *
 * Extracted from /api/portal/updates/route.ts so the exact same logic can run
 * from two different front doors: the Vercel route (polled by the browser)
 * and the self-hosted push server (push-server/server.ts), which calls this
 * on its own timer and forwards the result over a WebSocket instead of
 * waiting for the next poll. One function neither file can drift from the
 * other without the test (portal-updates.test.ts) noticing.
 *
 * This exists because the portal had no way to tell a student something
 * while they were looking at a different page. Chat lived on /community, the
 * bell lived in the shell header and only updated on navigation, and the
 * result was that a tutor's message reached a student when they next
 * happened to open the right screen — which for most students is never.
 */
import { prisma } from "@/lib/prisma";
import { resolveSpaceScope } from "@/lib/community-spaces";
import { unreadByChannel, totalUnread } from "@/lib/community-unread";
import { previewOf } from "@/lib/community-notify";
import { storedNotificationLink } from "@/lib/notification-destinations";
import { normalizeAdminRole } from "@/lib/admin-roles";

/** A hard cap, so a browser (or a push-server tick) left behind does not get a wall. */
const MAX_ITEMS = 8;

export type PortalUpdate = {
  id: string;
  source: "chat" | "notification";
  title: string;
  body: string;
  link: string | null;
  kind?: string | null;
  at: string;
  severity: string;
  author: { name: string } | null;
};

export type PortalUpdatesResult = { updates: PortalUpdate[]; unread: number; now: string };

export async function loadPortalUpdates(input: { userId: string; role: string | null | undefined; since: Date }): Promise<PortalUpdatesResult> {
  const { userId, role, since } = input;
  const now = new Date();

  const isPartnerAccount =
    String(role ?? "").toLowerCase() === "admin" &&
    (await prisma.user
      .findUnique({ where: { id: userId }, select: { adminRole: true } })
      .then((user) => normalizeAdminRole(user?.adminRole) === "influencer"));

  // resolveSpaceScope wants a plain string — a missing/null role on the
  // session falls through to its default (neither admin nor staff) branch,
  // same as the un-typed `(session.user as any).role` the old inline code
  // passed through before this was extracted.
  const scope = await resolveSpaceScope({ userId, role: role ?? "" });

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
        ...(isPartnerAccount ? { audience: null } : {}),
        channel: "in-app",
        readAt: null,
        createdAt: { gt: since },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS,
    }),

    channels.length ? unreadByChannel(userId, channels.map((c) => c.id)) : Promise.resolve({} as Record<string, number>),
  ]);

  const updates: PortalUpdate[] = [
    ...messages.map((message) => ({
      id: `chat:${message.id}`,
      source: "chat" as const,
      title: `${message.author.name ?? "Someone"} · ${channelName.get(message.channelId) ?? "Community"}`,
      body: previewOf(message.body, Boolean(message.attachmentUrl), message.attachmentType),
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
      link: storedNotificationLink(notification.kind, notification.link),
      kind: notification.kind,
      at: notification.createdAt.toISOString(),
      severity: notification.severity,
      author: null,
    })),
  ]
    // Newest first, then capped: on a busy morning the student sees the most
    // recent handful rather than a stack they have to dismiss one at a time.
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_ITEMS);

  return {
    updates,
    unread: totalUnread(unread),
    // The caller echoes this back as `since`, so the window is defined by the
    // server's clock throughout. A phone with the wrong time cannot then miss
    // messages or replay them.
    now: now.toISOString(),
  };
}

/**
 * A missing or absurd cursor means "start from now", never "start from the
 * beginning". A first connection must not replay the term's backlog as
 * popups, and a clock-skewed phone must not either — which is why the
 * cursor is also clamped to the last hour. Shared so the route and the push
 * server clamp identically.
 */
export function clampSince(sinceParam: string | null | undefined, now: Date): Date {
  const parsed = sinceParam ? new Date(sinceParam) : null;
  const floor = new Date(now.getTime() - 60 * 60_000);
  return parsed && !Number.isNaN(parsed.getTime()) ? new Date(Math.max(parsed.getTime(), floor.getTime())) : now;
}
