import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeChannel, isStaffRole } from "@/lib/community-spaces";
import { markChannelRead } from "@/lib/community-unread";
import { sendPushToUsers, spaceMemberIds } from "@/lib/push";

/** GET /api/community/threads?channelId=... — thread list for one channel. */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const channelId = new URL(request.url).searchParams.get("channelId");
  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  }

  try {
    const viewer = { userId: session.user.id as string, role: (session.user as any).role };
    const channel = await authorizeChannel(viewer, channelId);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found in your community" }, { status: 403 });
    }

    const threads = await prisma.thread.findMany({
      where: { channelId },
      orderBy: [{ pinned: "desc" }, { lastActivityAt: "desc" }],
      take: 50,
      include: {
        author: { select: { id: true, name: true, role: true } },
        _count: { select: { comments: true } },
      },
    });

    return NextResponse.json({
      channel: {
        id: channel.id,
        name: channel.name,
        slug: channel.slug,
        description: channel.description,
        spaceName: channel.space.name,
        branchName: channel.space.branch.name,
        level: channel.space.level,
      },
      threads,
    });
  } catch (error) {
    console.error("Community threads error:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      error: "Unable to load threads",
      details: process.env.NODE_ENV === "development" ? errorMsg : undefined
    }, { status: 500 });
  }
}

/** POST /api/community/threads — start a new thread. */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { channelId, title, body } = await request.json();
    const cleanTitle = typeof title === "string" ? title.trim() : "";
    const cleanBody = typeof body === "string" ? body.trim() : "";

    if (!channelId || !cleanTitle || !cleanBody) {
      return NextResponse.json({ error: "channelId, title and body are required" }, { status: 400 });
    }
    if (cleanTitle.length > 180) {
      return NextResponse.json({ error: "Title must be 180 characters or fewer" }, { status: 400 });
    }

    const viewer = { userId: session.user.id as string, role: (session.user as any).role };
    const channel = await authorizeChannel(viewer, channelId);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found in your community" }, { status: 403 });
    }

    // Announcement channels are presented to students as coming from their
    // tutors, and a new thread there pushes a notification to the whole space.
    // Only staff may broadcast; replies stay open to everyone.
    if (channel.kind === "announcement" && !isStaffRole(viewer.role)) {
      return NextResponse.json(
        { error: "Only tutors and staff can post in this channel." },
        { status: 403 },
      );
    }

    const thread = await prisma.thread.create({
      data: {
        channelId,
        authorId: viewer.userId,
        title: cleanTitle,
        body: cleanBody,
        lastActivityAt: new Date(),
      },
      include: {
        author: { select: { id: true, name: true, role: true } },
        _count: { select: { comments: true } },
      },
    });

    // Your own post should never leave an unread badge on your own sidebar.
    await markChannelRead(viewer.userId, channelId);

    // Notify the rest of the space. Deliberately not awaited: a slow or failing
    // push service must not make the student's post appear to fail.
    void (async () => {
      try {
        const recipients = await spaceMemberIds(channel.spaceId, viewer.userId);
        await sendPushToUsers(recipients, {
          title: `${channel.space.name} · #${channel.slug}`,
          body: `${thread.author.name ?? "Someone"}: ${cleanTitle}`,
          url: "/community",
          tag: `thread-${thread.id}`,
        });
      } catch (e) {
        console.error("Thread push failed:", e);
      }
    })();

    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    console.error("Create thread error:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      error: "Unable to create thread",
      details: process.env.NODE_ENV === "development" ? errorMsg : undefined
    }, { status: 500 });
  }
}
