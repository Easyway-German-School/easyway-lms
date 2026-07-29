import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveSpaceScope } from "@/lib/community-spaces";
import { unreadByChannel, totalUnread } from "@/lib/community-unread";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/community/unread — just the badge number.
 *
 * Deliberately lighter than /spaces: the floating launcher polls this from
 * every page in the portal, so it must not drag the whole sidebar payload
 * along with it.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    // Signed-out users simply have nothing waiting; not an error worth logging.
    return NextResponse.json({ total: 0 });
  }

  try {
    const userId = session.user.id as string;
    const scope = await resolveSpaceScope({ userId, role: (session.user as any).role });
    if (scope.spaceIds.length === 0) return NextResponse.json({ total: 0 });

    const channels = await prisma.channel.findMany({
      where: { spaceId: { in: scope.spaceIds } },
      select: { id: true },
    });

    const unread = await unreadByChannel(userId, channels.map((c) => c.id));
    return NextResponse.json({ total: totalUnread(unread) });
  } catch (error) {
    console.error("Community unread error:", error);
    return NextResponse.json({ total: 0 });
  }
}
