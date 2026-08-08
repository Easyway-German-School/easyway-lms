import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeThread } from "@/lib/community-spaces";
import { markChannelRead } from "@/lib/community-unread";
import { sendPushToUsers, threadParticipantIds } from "@/lib/push";

/** POST /api/community/comments — reply to a thread, or to another comment. */
export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { threadId, body, parentId } = await request.json();
    const cleanBody = typeof body === "string" ? body.trim() : "";

    if (!threadId || !cleanBody) {
      return NextResponse.json({ error: "threadId and body are required" }, { status: 400 });
    }

    const viewer = { userId: session.user.id as string, role: (session.user as any).role };
    const thread = await authorizeThread(viewer, threadId);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found in your community" }, { status: 403 });
    }

    // A parent reply must belong to this same thread, so a crafted parentId
    // cannot graft a comment onto another community's thread.
    if (parentId) {
      const parent = await prisma.comment.findUnique({
        where: { id: String(parentId) },
        select: { threadId: true },
      });
      if (!parent || parent.threadId !== threadId) {
        return NextResponse.json({ error: "Invalid parent comment" }, { status: 400 });
      }
    }

    const comment = await prisma.comment.create({
      data: {
        threadId,
        authorId: viewer.userId,
        parentId: parentId ? String(parentId) : null,
        body: cleanBody,
      },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    await prisma.thread.update({
      where: { id: threadId },
      data: { lastActivityAt: new Date() },
    });

    await markChannelRead(viewer.userId, thread.channelId);

    // Replies reach the people already in the conversation — author plus prior
    // repliers — rather than the whole space. Not awaited, same as threads.
    void (async () => {
      try {
        const recipients = await threadParticipantIds(threadId, viewer.userId);
        await sendPushToUsers(recipients, {
          title: `Reply in "${thread.title}"`,
          body: `${comment.author.name ?? "Someone"}: ${cleanBody.slice(0, 140)}`,
          url: "/community",
          tag: `thread-${threadId}`,
        });
      } catch (e) {
        console.error("Comment push failed:", e);
      }
    })();

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    console.error("Create comment error:", error);
    return NextResponse.json({ error: "Unable to post reply" }, { status: 500 });
  }
}
