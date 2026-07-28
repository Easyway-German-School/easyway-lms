import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCommunityCourseIds, normalizeCommunityRole } from "@/lib/community-access";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = normalizeCommunityRole(session.user.role);
    if (!role) return NextResponse.json({ error: "Unsupported account role" }, { status: 403 });
    const courseIds = await getCommunityCourseIds(session.user.id, role);

    const { searchParams } = new URL(req.url);
    const courseId = searchParams.get("courseId");

    if (courseIds !== null && courseIds.length === 0) {
      return NextResponse.json([]);
    }

    let where: any = courseIds === null ? {} : { courseId: { in: courseIds } };
    if (courseId && (courseIds === null || courseIds.includes(courseId))) {
      where = { courseId };
    }

    const discussions = await prisma.discussion.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true }
        },
        course: {
          select: { id: true, title: true, level: true }
        },
        replies: {
          include: {
            user: {
              select: { id: true, name: true }
            }
          },
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: [
        { pinned: "desc" },
        { createdAt: "desc" }
      ],
    });

    return NextResponse.json(discussions);
  } catch (error) {
    console.error("Error fetching discussions:", error);
    return NextResponse.json(
      { error: "Failed to fetch discussions" },
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

    const { courseId, title, content } = await req.json();
    const normalizedTitle = typeof title === "string" ? title.trim() : "";
    const normalizedContent = typeof content === "string" ? content.trim() : "";

    if (typeof courseId !== "string" || !courseId || !normalizedTitle || !normalizedContent) {
      return NextResponse.json(
        { error: "courseId, title, and content are required" },
        { status: 400 }
      );
    }

    const role = normalizeCommunityRole(session.user.role);
    const courseIds = role ? await getCommunityCourseIds(session.user.id, role) : [];
    if (!role || (courseIds !== null && !courseIds.includes(courseId))) {
      return NextResponse.json(
        { error: "You are not authorized to use this course community" },
        { status: 403 }
      );
    }

    const discussion = await prisma.discussion.create({
      data: {
        courseId,
        userId: session.user.id,
        title: normalizedTitle,
        content: normalizedContent,
      },
      include: {
        user: {
          select: { id: true, name: true }
        },
        course: {
          select: { id: true, title: true }
        },
        replies: true
      }
    });

    return NextResponse.json(discussion);
  } catch (error) {
    console.error("Error creating discussion:", error);
    return NextResponse.json(
      { error: "Failed to create discussion" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { discussionId, action } = await req.json();
    if (typeof discussionId !== "string" || !discussionId || typeof action !== "string") {
      return NextResponse.json({ error: "discussionId and action are required" }, { status: 400 });
    }

    const discussion = await prisma.discussion.findUnique({ where: { id: discussionId } });
    if (!discussion) {
      return NextResponse.json({ error: "Discussion not found" }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    const isModerator = user?.role?.toLowerCase() === "admin" || discussion.userId === session.user.id;
    if (!isModerator) {
      return NextResponse.json({ error: "Only admins or the author can moderate this thread" }, { status: 403 });
    }

    const updatedDiscussion = await prisma.discussion.update({
      where: { id: discussionId },
      data: action === "pin" ? { pinned: true } : action === "unpin" ? { pinned: false } : {},
    });

    return NextResponse.json(updatedDiscussion);
  } catch (error) {
    console.error("Error updating discussion:", error);
    return NextResponse.json({ error: "Failed to update discussion" }, { status: 500 });
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

    const discussion = await prisma.discussion.findUnique({ where: { id } });
    if (!discussion) {
      return NextResponse.json({ error: "Discussion not found" }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    const isModerator = user?.role?.toLowerCase() === "admin" || discussion.userId === session.user.id;
    if (!isModerator) {
      return NextResponse.json({ error: "Only admins or the author can remove this thread" }, { status: 403 });
    }

    await prisma.discussion.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting discussion:", error);
    return NextResponse.json({ error: "Failed to delete discussion" }, { status: 500 });
  }
}
