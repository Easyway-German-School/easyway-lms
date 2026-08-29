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
   * Grouped in the database rather than pulled into memory, and BUCKETED BY
   * CUTOFF rather than one query per channel.
   *
   * The forum version fetched every thread in every visible channel and counted
   * them in JS, which was survivable at forum volume and is not at chat volume.
   * The version after it fixed that but issued `count()` once per channel
   * inside a single `Promise.all`, on the stated assumption that a member sees
   * three channels.
   *
   * That assumption is true for a student and false for everybody else. Staff
   * see every room in the school — eighteen spaces of three channels here — so
   * the sidebar fired fifty-four concurrent counts at a nine-connection pool,
   * exhausted it, and the whole request died on
   * "Timed out fetching a new connection from the connection pool". What the
   * office actually saw was "Unable to load community spaces" on every portal,
   * which reads as the community being broken rather than as a pool limit.
   *
   * Channels that share a cutoff can be counted together, so they are: one
   * grouped query per DISTINCT marker instead of one per channel. Staff who
   * have opened nothing collapse to a single query. A student keeps the three
   * they had. The bucket count is bounded by distinct timestamps rather than by
   * channels, and the loop is capped anyway so a pathological spread still
   * cannot outrun the pool.
   */
  const buckets = new Map<string, { since: Date | null; ids: string[] }>();
  for (const channelId of channelIds) {
    const since = readAt.get(channelId) ?? null;
    const key = since ? since.toISOString() : "never";
    const bucket = buckets.get(key);
    if (bucket) bucket.ids.push(channelId);
    else buckets.set(key, { since, ids: [channelId] });
  }

  /** Well under the pool so the bell and the page can still get a connection. */
  const MAX_CONCURRENT_BUCKETS = 4;
  const bucketList = [...buckets.values()];

  for (let index = 0; index < bucketList.length; index += MAX_CONCURRENT_BUCKETS) {
    await Promise.all(
      bucketList.slice(index, index + MAX_CONCURRENT_BUCKETS).map(async ({ since, ids }) => {
        const rows = await prisma.message.groupBy({
          by: ["channelId"],
          where: {
            channelId: { in: ids },
            hiddenAt: null,
            authorId: { not: userId },
            ...(since ? { createdAt: { gt: since } } : {}),
          },
          _count: { _all: true },
        });
        // groupBy omits channels with no matching rows; those keep the 0
        // seeded above, which is the answer for them anyway.
        for (const row of rows) counts[row.channelId] = row._count._all;
      }),
    );
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
