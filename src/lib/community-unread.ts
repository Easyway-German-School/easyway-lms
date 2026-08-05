import { prisma } from "@/lib/prisma";

/**
 * Unread state for the community hub.
 *
 * A thread counts as unread for a member when its lastActivityAt (bumped by
 * new replies as well as new threads) is newer than that member's read marker
 * for the channel. A member who has never opened a channel has no marker, so
 * everything in it reads as unread — which is what puts a badge in front of a
 * brand-new student on day one.
 *
 * Posting marks the channel read, so your own message never leaves a badge
 * sitting on your own sidebar.
 */

/** Unread thread count per channel id, for the channels passed in. */
export async function unreadByChannel(
  userId: string,
  channelIds: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (channelIds.length === 0) return counts;

  // Two queries regardless of channel count: the markers, then the activity.
  const [markers, threads] = await Promise.all([
    prisma.channelRead.findMany({
      where: { userId, channelId: { in: channelIds } },
      select: { channelId: true, lastReadAt: true },
    }),
    prisma.thread.findMany({
      where: { channelId: { in: channelIds } },
      select: { channelId: true, lastActivityAt: true },
    }),
  ]);

  const readAt = new Map(markers.map((m) => [m.channelId, m.lastReadAt.getTime()]));
  for (const id of channelIds) counts[id] = 0;

  for (const thread of threads) {
    // No marker => never opened => everything is new.
    const seenAt = readAt.get(thread.channelId) ?? 0;
    if (thread.lastActivityAt.getTime() > seenAt) {
      counts[thread.channelId] = (counts[thread.channelId] ?? 0) + 1;
    }
  }

  return counts;
}

/** Stamp a channel as read up to now. Safe to call on every channel open. */
export async function markChannelRead(userId: string, channelId: string) {
  const now = new Date();
  await prisma.channelRead.upsert({
    where: { userId_channelId: { userId, channelId } },
    update: { lastReadAt: now },
    create: { userId, channelId, lastReadAt: now },
  });
  return now;
}

/**
 * Total unread across every channel the member can see — the number that goes
 * on the floating launcher so it is visible from anywhere in the portal.
 */
export function totalUnread(counts: Record<string, number>) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}
