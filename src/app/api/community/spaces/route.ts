import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listVisibleSpaces } from "@/lib/community-spaces";
import { unreadByChannel, totalUnread } from "@/lib/community-unread";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = session.user.id as string;
    const { spaces, scope } = await listVisibleSpaces({
      userId,
      role: (session.user as any).role,
    });

    const channelIds = spaces.flatMap((space) => space.channels.map((c) => c.id));
    const unread = await unreadByChannel(userId, channelIds);

    // Fold the per-channel counts into the payload the sidebar already renders.
    const withUnread = spaces.map((space) => ({
      ...space,
      channels: space.channels.map((channel) => ({
        ...channel,
        unreadCount: unread[channel.id] ?? 0,
      })),
    }));

    return NextResponse.json({
      spaces: withUnread,
      isStaff: scope.isStaff,
      unreadTotal: totalUnread(unread),
      // Helps the UI explain an empty state (e.g. student with no branch set).
      scope: { branchId: scope.branchId, level: scope.level },
    });
  } catch (error) {
    console.error("Community spaces error:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      error: "Unable to load community spaces",
      details: process.env.NODE_ENV === "development" ? errorMsg : undefined
    }, { status: 500 });
  }
}
