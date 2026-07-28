import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCommunityCourseIds, normalizeCommunityRole } from "@/lib/community-access";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { discussionId, content } = await req.json();
    const normalizedContent = typeof content === "string" ? content.trim() : "";

    if (typeof discussionId !== "string" || !discussionId || !normalizedContent) {
      return NextResponse.json(
        { error: "discussionId and content are required" },
        { status: 400 }
      );
    }

    // Verify discussion exists
    const discussion = await prisma.discussion.findUnique({
      where: { id: discussionId },
      include: {
        course: true
      }
    });

    if (!discussion) {
      return NextResponse.json(
        { error: "Discussion not found" },
        { status: 404 }
      );
    }

    const role = normalizeCommunityRole(session.user.role);
    const courseIds = role ? await getCommunityCourseIds(session.user.id, role) : [];
    if (!role || (courseIds !== null && !courseIds.includes(discussion.courseId))) {
      return NextResponse.json(
        { error: "You are not authorized to use this course community" },
        { status: 403 }
      );
    }

    const reply = await prisma.reply.create({
      data: {
        discussionId,
        userId: session.user.id,
        content: normalizedContent
      },
      include: {
        user: {
          select: { id: true, name: true }
        }
      }
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
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    // Verify the reply belongs to the user (they can delete their own replies)
    const reply = await prisma.reply.findUnique({
      where: { id }
    });

    if (!reply) {
      return NextResponse.json(
        { error: "Reply not found" },
        { status: 404 }
      );
    }

    // Check if user is admin or owns the reply
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    });

    if (reply.userId !== session.user.id && user?.role?.toLowerCase() !== "admin") {
      return NextResponse.json(
        { error: "You can only delete your own replies" },
        { status: 403 }
      );
    }

    await prisma.reply.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting reply:", error);
    return NextResponse.json(
      { error: "Failed to delete reply" },
      { status: 500 }
    );
  }
}
