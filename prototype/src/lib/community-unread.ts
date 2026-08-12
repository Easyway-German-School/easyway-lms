import { prisma } from "@/lib/prisma";

/**
 * Unread state for the group chat.
 *
 * A message counts as unread when it arrived after this member's read marker
 * for the channel, and somebody else sent it. Both halves matter:
 *
 *   - No marker means the member has never opened the channel, so everything in
 *     it is new. That is what puts a badge in front of a student on day one.
 *   - Your own messages never count. The old forum counted threads regardless
 *     of author, so posting left a badge sitting on your own sidebar — which is
 *     a small thing that makes a chat feel broken, because no messaging app
 *     anybody uses behaves that way.
 *
 * Hidden messages do not count either. A student should not be nudged towards a
 * room to read something a moderator has already taken down.
 */

/** Unread message count per channel id, for the channels passed in. */
export async function unreadByChannel(
  userId: string,
  channelIds: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (channelIds.length === 0) return counts;
  for (const id of channelIds) counts[id] = 0;

  const markers = await prisma.channelRead.findMany({
    where: { userId, channelId: { in: channelIds } },
    select: { channelId: true, lastReadAt: true },
  });
  const readAt = new Map(markers.map((m) => [m.channelId, m.lastReadAt]));

  /**
   * Grouped in the database rather than pulled into memory.
   *
   * The forum version fetched every thread in every visible channel and counted
   * them in JS, which was survivable at forum volume and is not at chat volume —
   * a term of forty students talking is tens of thousands of rows, fetched on
   * every sidebar render. `groupBy` returns one row per channel instead.
   *
   * The per-channel cutoff cannot be expressed in a single grouped query, so
   * channels are bucketed by their marker: in practice a member has one marker
   * per channel and there are three channels, so this is three cheap indexed
   * counts against `[channelId, createdAt]`.
   */
  await Promise.all(
    channelIds.map(async (channelId) => {
      const since = readAt.get(channelId);
      counts[channelId] = await prisma.message.count({
        where: {
          channelId,
          hiddenAt: null,
          authorId: { not: userId },
          ...(since ? { createdAt: { gt: since } } : {}),
        },
      });
    }),
  );

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
