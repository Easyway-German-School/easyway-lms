import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeCommunityRole, getCommunityCourseIds } from "@/lib/community-access";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = normalizeCommunityRole(session.user.role);
    if (!role) {
      return NextResponse.json({ error: "Unsupported account role" }, { status: 403 });
    }

    const courseIds = await getCommunityCourseIds(session.user.id, role);
    const { searchParams } = new URL(req.url);
    const discussionId = searchParams.get("discussionId");

    if (!discussionId) {
      return NextResponse.json({ error: "discussionId is required" }, { status: 400 });
    }

    const discussion = await prisma.discussion.findUnique({
      where: { id: discussionId },
      include: {
        replies: {
          include: {
            user: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!discussion) {
      return NextResponse.json({ error: "Discussion not found" }, { status: 404 });
    }

    if (courseIds !== null && !courseIds.includes(discussion.courseId)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    return NextResponse.json(discussion.replies);
  } catch (error) {
    console.error("Error fetching replies:", error);
    return NextResponse.json(
      { error: "Failed to fetch replies" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { discussionId, content } = await req.json();
    if (!discussionId || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "discussionId and content are required" }, { status: 400 });
    }

    const discussion = await prisma.discussion.findUnique({ where: { id: discussionId } });
    if (!discussion) {
      return NextResponse.json({ error: "Discussion not found" }, { status: 404 });
    }

    const role = normalizeCommunityRole(session.user.role);
    const courseIds = role ? await getCommunityCourseIds(session.user.id, role) : [];
    if (!role || (courseIds !== null && !courseIds.includes(discussion.courseId))) {
      return NextResponse.json({ error: "You are not authorized to reply to this discussion" }, { status: 403 });
    }

    const reply = await prisma.reply.create({
      data: {
        discussionId,
        userId: session.user.id,
        content: content.trim(),
      },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(reply);
  } catch (error) {
    console.error("Error creating reply:", error);
    return NextResponse.json(
      { error: "Failed to create reply" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const reply = await prisma.reply.findUnique({ where: { id } });
    if (!reply) {
      return NextResponse.json({ error: "Reply not found" }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    const isModerator = user?.role?.toLowerCase() === "admin" || reply.userId === session.user.id;
    if (!isModerator) {
      return NextResponse.json({ error: "Only admins or the author can remove this reply" }, { status: 403 });
    }

    await prisma.reply.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting reply:", error);
    return NextResponse.json({ error: "Failed to delete reply" }, { status: 500 });
  }
}
