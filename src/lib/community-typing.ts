import { prisma } from "@/lib/prisma";
import { resolveSpaceScope, type Viewer } from "@/lib/community-spaces";
import { TYPING_LIVE_MS, TYPING_STALE_MS, firstName, type Typer } from "@/lib/typing";

/**
 * Typing signals for community rooms — the server half.
 *
 * Two readers share one table (TypingPing):
 *
 *   - a room asks "who is typing HERE?"          → {@link typersInChannel}
 *   - the whole portal asks "who is typing in ANY of my rooms?" → {@link typingFeedFor}
 *
 * The second is what lets a student doing an exercise on another page see
 * "Anna is typing in General" and get pulled back to the class chat. See
 * lib/typing.ts for the stamp / window model both are built on.
 */

/** Stamp "this person is typing in this channel" (idempotent, one row each). */
export async function stampTyping(channelId: string, userId: string) {
  const now = new Date();
  await prisma.typingPing.upsert({
    where: { channelId_userId: { channelId, userId } },
    update: { updatedAt: now },
    create: { channelId, userId },
  });

  // Opportunistic sweep, and only on roughly one stamp in eight — the table is
  // tiny and the live window already hides stale rows from readers, so this is
  // housekeeping, not correctness. It keeps the table from carrying rows for
  // people who closed the tab three lessons ago, without a scheduled job.
  if (Math.random() < 0.125) {
    await prisma.typingPing
      .deleteMany({ where: { channelId, updatedAt: { lt: new Date(now.getTime() - TYPING_STALE_MS) } } })
      .catch(() => {});
  }
}

/**
 * "I stopped" — the message was sent, or the box was emptied. Without this the
 * dots would linger for the rest of the live window after every send, which is
 * the one thing that makes a typing indicator feel fake.
 */
export async function clearTyping(channelId: string, userId: string) {
  await prisma.typingPing.deleteMany({ where: { channelId, userId } }).catch(() => {});
}

/** Who else is typing in one channel right now. */
export async function typersInChannel(channelId: string, exceptUserId: string): Promise<Typer[]> {
  const rows = await prisma.typingPing.findMany({
    where: {
      channelId,
      userId: { not: exceptUserId },
      updatedAt: { gt: new Date(Date.now() - TYPING_LIVE_MS) },
    },
    select: { user: { select: { id: true, name: true, role: true } } },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });
  return rows.map((row) => ({ id: row.user.id, name: firstName(row.user.name), role: row.user.role }));
}

/* ------------------------------------------------------------------ the feed */

type Room = { id: string; name: string };

/**
 * A viewer's rooms, remembered per server instance for a short while.
 *
 * `resolveSpaceScope` is the honest answer to "which rooms may this person
 * see?", but it is a handful of queries (and, for a student, an upsert that
 * provisions their room on demand). Fine once per page load; not fine every
 * four seconds for every open tab in the school. Cohort membership changes on
 * the scale of weeks, so thirty seconds of staleness is invisible — and the
 * worst it can do is show a first name typing in a room the viewer was moved
 * out of half a minute ago. Reading and posting messages never uses this
 * cache; those routes ask `authorizeChannel` fresh every time.
 */
const ROOM_TTL_MS = 30_000;
const ROOM_CACHE_MAX = 2_000;
const roomCache = new Map<string, { at: number; rooms: Room[] }>();

async function roomsFor(viewer: Viewer): Promise<Room[]> {
  const hit = roomCache.get(viewer.userId);
  if (hit && Date.now() - hit.at < ROOM_TTL_MS) return hit.rooms;

  const scope = await resolveSpaceScope(viewer);

  const [cohortRooms, dm] = await Promise.all([
    scope.spaceIds.length
      ? prisma.channel.findMany({
          // No typing in an announcement channel — only staff post there.
          where: { spaceId: { in: scope.spaceIds }, kind: { not: "announcement" } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as Room[]),
    // A student's private thread with the office. Tutors have none by design.
    scope.isStaff
      ? Promise.resolve(null)
      : prisma.channel.findUnique({ where: { dmStudentId: viewer.userId }, select: { id: true } }),
  ]);

  const rooms: Room[] = [...cohortRooms, ...(dm ? [{ id: dm.id, name: "The office" }] : [])];

  if (roomCache.size >= ROOM_CACHE_MAX) roomCache.clear();
  roomCache.set(viewer.userId, { at: Date.now(), rooms });
  return rooms;
}

export type TypingFeedRoom = { channelId: string; channelName: string; typers: Typer[] };

/**
 * Everyone currently typing in any room the viewer belongs to.
 *
 * `enabled: false` for the office: admins asked not to be pinged about
 * classroom chatter, and they can already open any room. The room they ARE
 * looking at still shows dots through {@link typersInChannel}.
 */
export async function typingFeedFor(
  viewer: Viewer,
): Promise<{ enabled: boolean; rooms: TypingFeedRoom[] }> {
  if (String(viewer.role ?? "").toLowerCase() === "admin") return { enabled: false, rooms: [] };

  const rooms = await roomsFor(viewer);
  if (rooms.length === 0) return { enabled: true, rooms: [] };

  const rows = await prisma.typingPing.findMany({
    where: {
      channelId: { in: rooms.map((room) => room.id) },
      userId: { not: viewer.userId },
      updatedAt: { gt: new Date(Date.now() - TYPING_LIVE_MS) },
    },
    select: { channelId: true, user: { select: { id: true, name: true, role: true } } },
    orderBy: { updatedAt: "desc" },
    take: 60,
  });

  const nameOf = new Map(rooms.map((room) => [room.id, room.name]));
  const byChannel = new Map<string, Typer[]>();
  for (const row of rows) {
    const list = byChannel.get(row.channelId) ?? [];
    list.push({ id: row.user.id, name: firstName(row.user.name), role: row.user.role });
    byChannel.set(row.channelId, list);
  }

  return {
    enabled: true,
    rooms: [...byChannel.entries()].map(([channelId, typers]) => ({
      channelId,
      channelName: nameOf.get(channelId) ?? "Community",
      typers,
    })),
  };
}
