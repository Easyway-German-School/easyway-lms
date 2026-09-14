import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { listVisibleSpaces, listDmSpaceForViewer } from "@/lib/community-spaces";
import { unreadByChannel, totalUnread } from "@/lib/community-unread";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = session.user.id as string;
    const viewer = { userId, role: (session.user as any).role };
    const { spaces, scope } = await listVisibleSpaces(viewer);

    // The office's DM threads (or a student's own one, once an admin has
    // opened it) ride alongside the ordinary cohort rooms — same shape, same
    // sidebar, same unread machinery. A tutor gets null here and sees nothing.
    const dmSpace = await listDmSpaceForViewer(viewer);
    const allSpaces = dmSpace ? [...spaces, dmSpace] : spaces;

    const channelIds = allSpaces.flatMap((space) => space.channels.map((c) => c.id));
    const unread = await unreadByChannel(userId, channelIds);

    // Fold the per-channel counts into the payload the sidebar already renders.
    const withUnread = allSpaces.map((space) => ({
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
    console.error("Community spaces error:", error instanceof Error ? error.message : String(error));
    console.error("Full error:", error);
    return NextResponse.json(
      {
        error: "Unable to load community spaces",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
