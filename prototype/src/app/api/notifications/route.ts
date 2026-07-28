import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/notifications
 * Fetch in-app notifications for the logged-in student
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unread") === "true";
    const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);

    // Get student
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { student: true },
    });

    if (!user?.student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // Get notifications
    const notifications = await prisma.notification.findMany({
      where: {
        studentId: user.student.id,
        channel: "in-app",
        ...(unreadOnly && { readAt: null }),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      notifications,
      unreadCount: await prisma.notification.count({
        where: {
          studentId: user.student.id,
          channel: "in-app",
          readAt: null,
        },
      }),
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

/**
 * PATCH /api/notifications
 * Mark notifications as read
 */
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { notificationIds, markAllAsRead } = body;

    // Get student
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { student: true },
    });

    if (!user?.student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (markAllAsRead) {
      // Mark all unread notifications as read
      await prisma.notification.updateMany({
        where: {
          studentId: user.student.id,
          channel: "in-app",
          readAt: null,
        },
        data: { readAt: new Date() },
      });

      return NextResponse.json({ success: true, message: "All notifications marked as read" });
    }

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return NextResponse.json({ error: "notificationIds required" }, { status: 400 });
    }

    // Mark specific notifications as read
    const updated = await prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        studentId: user.student.id,
      },
      data: { readAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      message: `${updated.count} notification(s) marked as read`,
      updatedCount: updated.count,
    });
  } catch (error) {
    console.error("Error updating notifications:", error);
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications
 * Delete notifications
 */
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { notificationIds } = body;

    // Get student
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { student: true },
    });

    if (!user?.student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return NextResponse.json({ error: "notificationIds required" }, { status: 400 });
    }

    // Delete notifications
    const deleted = await prisma.notification.deleteMany({
      where: {
        id: { in: notificationIds },
        studentId: user.student.id,
      },
    });

    return NextResponse.json({
      success: true,
      message: `${deleted.count} notification(s) deleted`,
      deletedCount: deleted.count,
    });
  } catch (error) {
    console.error("Error deleting notifications:", error);
    return NextResponse.json({ error: "Failed to delete notifications" }, { status: 500 });
  }
}
