import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeThread, nestComments } from "@/lib/community-spaces";

/** GET /api/community/threads/[id] — one thread with its nested comment tree. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const viewer = { userId: session.user.id as string, role: (session.user as any).role };

    const allowed = await authorizeThread(viewer, id);
    if (!allowed) {
      return NextResponse.json({ error: "Thread not found in your community" }, { status: 403 });
    }

    const thread = await prisma.thread.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true, role: true } },
        channel: { select: { id: true, name: true, slug: true } },
      },
    });

    const rows = await prisma.comment.findMany({
      where: { threadId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        body: true,
        createdAt: true,
        parentId: true,
        author: { select: { id: true, name: true, role: true } },
      },
    });

    return NextResponse.json({ thread, comments: nestComments(rows), commentCount: rows.length });
  } catch (error) {
    console.error("Thread detail error:", error);
    return NextResponse.json({ error: "Unable to load thread" }, { status: 500 });
  }
}
