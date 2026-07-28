import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role?.toLowerCase() === "admin";
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!await isAdmin(session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const courseId = searchParams.get("courseId");

    const where = courseId ? { courseId } : {};

    const discussions = await prisma.discussion.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true }
        },
        course: {
          select: { title: true }
        },
        replies: {
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
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

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!await isAdmin(session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id, pinned } = await req.json();

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const discussion = await prisma.discussion.update({
      where: { id },
      data: {
        pinned: pinned !== undefined ? pinned : undefined
      },
      include: {
        user: {
          select: { id: true, name: true, email: true }
        },
        course: {
          select: { title: true }
        }
      }
    });

    return NextResponse.json(discussion);
  } catch (error) {
    console.error("Error updating discussion:", error);
    return NextResponse.json(
      { error: "Failed to update discussion" },
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

    if (!await isAdmin(session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await req.json();

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    await prisma.discussion.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting discussion:", error);
    return NextResponse.json(
      { error: "Failed to delete discussion" },
      { status: 500 }
    );
  }
}
