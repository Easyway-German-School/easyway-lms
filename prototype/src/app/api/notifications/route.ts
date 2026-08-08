import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * The bell, for whoever is signed in.
 *
 * This used to be student-only, and narrower than that in practice: it matched
 * `studentId` exactly and `channel: "in-app"`, so branch-wide and level-wide
 * broadcasts never appeared, the payment warnings (which stash their tier in
 * `channel`) never appeared, and staff had no bell at all. It now resolves
 * whoever is signed in — student, lecturer or admin — and answers with
 * everything actually addressed to them.
 *
 * Four ways a row can reach you, and a read is scoped to the same set so
 * nobody can mark somebody else's notification read:
 *
 *   userId is you        anything sent since src/lib/notify.ts existed
 *   studentId is yours   the original student-scoped rows
 *   branch / level       an unaddressed broadcast to your cohort
 *   audience             an unaddressed broadcast to your role
 */

type Viewer = {
  userId: string;
  role: string;
  studentId: string | null;
  branchId: string | null;
  level: string | null;
};

async function resolveViewer(): Promise<Viewer | null> {
  const session = await requireAuthSession();
  if (!session) return null;

  const id = session?.user?.id;
  const email = session?.user?.email;
  if (!id && !email) return null;

  const user = await prisma.user.findUnique({
    where: id ? { id } : { email: email as string },
    select: {
      id: true,
      role: true,
      student: { select: { id: true, branchId: true, level: true } },
    },
  });
  if (!user) return null;

  return {
    userId: user.id,
    role: String(user.role).toLowerCase(),
    studentId: user.student?.id ?? null,
    branchId: user.student?.branchId ?? null,
    level: user.student?.level ?? null,
  };
}

/**
 * Everything addressed to this viewer.
 *
 * `channel` is checked as "not email" rather than "is in-app" because the
 * payment-warning tiers write their marker into that column; testing for
 * equality is what hid them from students for as long as they have existed.
 */
function audienceFilter(viewer: Viewer): Prisma.NotificationWhereInput {
  // Every fanned-out row carries the audience it came from, so an unqualified
  // `audience: "admin"` clause would hand this admin every OTHER admin's copy.
  // Broadcast clauses therefore all pin `userId: null`, which is what makes a
  // row un-fanned — addressed to a group, nobody in particular.
  const reach: Prisma.NotificationWhereInput[] = [
    { userId: viewer.userId },
    { userId: null, audience: "all" },
    { userId: null, audience: viewer.role },
  ];

  if (viewer.studentId) {
    reach.push({ studentId: viewer.studentId });
    if (viewer.branchId) reach.push({ userId: null, branchId: viewer.branchId });
    if (viewer.level) reach.push({ userId: null, level: viewer.level });
    // The truly unaddressed row: nobody in particular, which in practice is a
    // notice to the whole school.
    reach.push({ userId: null, studentId: null, branchId: null, level: null, audience: null });
  }

  return { channel: { not: "email" }, OR: reach };
}

/** The same filter, but only rows this viewer is allowed to mutate. */
function ownedFilter(viewer: Viewer): Prisma.NotificationWhereInput {
  const owned: Prisma.NotificationWhereInput[] = [{ userId: viewer.userId }];
  if (viewer.studentId) owned.push({ studentId: viewer.studentId });
  return { OR: owned };
}

export async function GET(request: Request) {
  try {
    const viewer = await resolveViewer();
    if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unread") === "true";
    const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);

    const where = audienceFilter(viewer);

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: unreadOnly ? { AND: [where, { readAt: null }] } : where,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          title: true,
          message: true,
          kind: true,
          severity: true,
          link: true,
          channel: true,
          status: true,
          readAt: true,
          createdAt: true,
          sender: { select: { name: true, role: true } },
        },
      }),
      prisma.notification.count({ where: { AND: [where, { readAt: null }] } }),
    ]);

    return NextResponse.json({
      unreadCount,
      notifications: notifications.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        kind: n.kind,
        severity: n.severity,
        link: n.link,
        channel: n.channel,
        status: n.status,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
        senderName: n.sender?.name ?? null,
        senderRole: n.sender ? String(n.sender.role).toLowerCase() : null,
      })),
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const viewer = await resolveViewer();
    if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { notificationIds, markAllAsRead } = body as {
      notificationIds?: unknown;
      markAllAsRead?: boolean;
    };

    if (markAllAsRead) {
      // Everything they can SEE, not only what is addressed to them
      // individually — otherwise "mark all as read" leaves the badge showing.
      const updated = await prisma.notification.updateMany({
        where: { AND: [audienceFilter(viewer), { readAt: null }] },
        data: { readAt: new Date() },
      });
      return NextResponse.json({ success: true, updatedCount: updated.count });
    }

    const ids = Array.isArray(notificationIds) ? notificationIds.filter((id) => typeof id === "string") : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "notificationIds required" }, { status: 400 });
    }

    const updated = await prisma.notification.updateMany({
      where: { AND: [audienceFilter(viewer), { id: { in: ids } }] },
      data: { readAt: new Date() },
    });

    return NextResponse.json({ success: true, updatedCount: updated.count });
  } catch (error) {
    console.error("Error updating notifications:", error);
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const viewer = await resolveViewer();
    if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.notificationIds)
      ? (body.notificationIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: "notificationIds required" }, { status: 400 });
    }

    // Only rows belonging to this person are deletable. Dismissing a broadcast
    // must not delete it out from under everyone else it was sent to, so those
    // are marked read instead.
    const [deleted, hidden] = await Promise.all([
      prisma.notification.deleteMany({
        where: { AND: [ownedFilter(viewer), { id: { in: ids } }] },
      }),
      prisma.notification.updateMany({
        where: { AND: [audienceFilter(viewer), { id: { in: ids } }, { userId: null }, { studentId: null }] },
        data: { readAt: new Date() },
      }),
    ]);

    return NextResponse.json({
      success: true,
      deletedCount: deleted.count,
      dismissedCount: hidden.count,
    });
  } catch (error) {
    console.error("Error deleting notifications:", error);
    return NextResponse.json({ error: "Failed to delete notifications" }, { status: 500 });
  }
}
