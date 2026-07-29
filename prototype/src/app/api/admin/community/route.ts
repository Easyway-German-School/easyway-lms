import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * Admin moderation for the community hub.
 *
 * Students post into branch+level Spaces (see src/lib/community-spaces.ts);
 * this is the one view that deliberately ignores that scoping so staff can
 * see every space at once. Admin-only, like the rest of /admin — the student
 * routes are what lecturers use.
 */

async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role?.toLowerCase() === "admin";
}

async function requireAdmin() {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await isAdmin(session.user.id))) {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { userId: session.user.id as string };
}

/** GET — every thread, newest activity first, optionally filtered. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const { searchParams } = new URL(req.url);
    const spaceId = searchParams.get("spaceId");
    const branchId = searchParams.get("branchId");
    const level = searchParams.get("level");
    const search = searchParams.get("search")?.trim();

    const spaceWhere: Record<string, unknown> = {};
    if (spaceId) spaceWhere.id = spaceId;
    if (branchId) spaceWhere.branchId = branchId;
    if (level) spaceWhere.level = level;

    const threads = await prisma.thread.findMany({
      where: {
        ...(Object.keys(spaceWhere).length ? { channel: { space: spaceWhere } } : {}),
        ...(search
          ? { OR: [{ title: { contains: search } }, { body: { contains: search } }] }
          : {}),
      },
      orderBy: [{ pinned: "desc" }, { lastActivityAt: "desc" }],
      take: 200,
      include: {
        author: { select: { id: true, name: true, email: true, role: true } },
        channel: {
          select: {
            id: true,
            name: true,
            slug: true,
            space: {
              select: { id: true, name: true, level: true, branch: { select: { id: true, name: true } } },
            },
          },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            body: true,
            createdAt: true,
            author: { select: { id: true, name: true, email: true, role: true } },
          },
        },
      },
    });

    // Filter options for the page, so it never has to guess what exists.
    const spaces = await prisma.space.findMany({
      orderBy: [{ level: "asc" }],
      select: { id: true, name: true, level: true, branch: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ threads, spaces });
  } catch (error) {
    console.error("Error fetching community threads:", error);
    return NextResponse.json({ error: "Failed to fetch threads" }, { status: 500 });
  }
}

/** PATCH — pin or unpin a thread. */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const { id, pinned } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const thread = await prisma.thread.update({
      where: { id: String(id) },
      data: { pinned: Boolean(pinned) },
      include: { author: { select: { id: true, name: true, email: true, role: true } } },
    });

    return NextResponse.json(thread);
  } catch (error) {
    console.error("Error updating thread:", error);
    return NextResponse.json({ error: "Failed to update thread" }, { status: 500 });
  }
}

/**
 * DELETE — remove a thread (and its comment tree) or a single comment.
 * `type` defaults to "thread" so an id alone behaves as it always did.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const { id, type } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (type === "comment") {
      await prisma.comment.delete({ where: { id: String(id) } });
    } else {
      await prisma.thread.delete({ where: { id: String(id) } });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting community item:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
