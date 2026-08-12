import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { slotLabel } from "@/lib/community-spaces";

/**
 * Admin moderation for the community.
 *
 * Students are confined to one room — their branch, their level, their sitting
 * (see src/lib/community-spaces.ts). This is the one view that deliberately
 * ignores that scoping, because the school promised its students a monitored
 * space and that promise needs somebody who can actually see all of it.
 *
 * Everything here reads the whole school. Nothing here edits what anybody
 * wrote: a moderator may take a message down and put it back, and that is the
 * complete list. Staff who could silently rewrite a student's words would make
 * every transcript in the school worthless the moment it mattered.
 */

/** GET — the most recent messages across every room, newest first. */
export async function GET(req: NextRequest) {
  const gate = await requireCapability("community");
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = new URL(req.url);
    const spaceId = searchParams.get("spaceId");
    const branchId = searchParams.get("branchId");
    const level = searchParams.get("level");
    const sessionSlot = searchParams.get("sessionSlot");
    const search = searchParams.get("search")?.trim();
    // "Show me what I have taken down" is a real moderation question and used
    // to have no answer, because hiding was a delete.
    const hiddenOnly = searchParams.get("hidden") === "true";

    const spaceWhere: Record<string, unknown> = {};
    if (spaceId) spaceWhere.id = spaceId;
    if (branchId) spaceWhere.branchId = branchId;
    if (level) spaceWhere.level = level;
    if (sessionSlot) spaceWhere.sessionSlot = sessionSlot;

    const messages = await prisma.message.findMany({
      where: {
        ...(Object.keys(spaceWhere).length ? { channel: { space: spaceWhere } } : {}),
        ...(hiddenOnly ? { hiddenAt: { not: null } } : {}),
        ...(search ? { body: { contains: search, mode: "insensitive" as const } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        author: { select: { id: true, name: true, email: true, role: true } },
        hiddenBy: { select: { id: true, name: true } },
        replyTo: { select: { id: true, body: true, author: { select: { name: true } } } },
        channel: {
          select: {
            id: true,
            name: true,
            slug: true,
            space: {
              select: {
                id: true,
                name: true,
                level: true,
                sessionSlot: true,
                branch: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    /**
     * Filter options, so the page never has to guess what exists.
     *
     * Ordered branch → level → sitting, which is the order somebody looking for
     * "the Lagos A1 evening class" thinks in. The label is built here rather
     * than in the UI so the admin list and the student's own header agree on
     * what a room is called.
     */
    const spaceRows = await prisma.space.findMany({
      orderBy: [{ branchId: "asc" }, { level: "asc" }, { sessionSlot: "asc" }],
      select: {
        id: true,
        name: true,
        level: true,
        sessionSlot: true,
        branch: { select: { id: true, name: true } },
      },
    });

    const spaces = spaceRows.map((space) => ({
      ...space,
      label: `${space.branch?.name ?? "EasyWay"} · ${space.level} · ${slotLabel(space.sessionSlot)}`,
    }));

    return NextResponse.json({ messages, spaces });
  } catch (error) {
    console.error("Error fetching community messages:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

/**
 * PATCH — take a message down, or put it back.
 *
 * A soft hide, always. The moment a school most needs a record of what was
 * written is the moment somebody has just removed it, so the row survives and
 * only its visibility to students changes.
 */
export async function PATCH(req: NextRequest) {
  const gate = await requireCapability("community");
  if (!gate.ok) return gate.response;

  try {
    const { id, hidden, reason } = await req.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const message = await prisma.message.update({
      where: { id: String(id) },
      data: hidden
        ? {
            hiddenAt: new Date(),
            hiddenById: gate.session.user.id as string,
            hiddenReason: String(reason ?? "").slice(0, 300) || "Removed by a moderator",
          }
        : { hiddenAt: null, hiddenById: null, hiddenReason: null },
      include: {
        author: { select: { id: true, name: true, email: true, role: true } },
        hiddenBy: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(message);
  } catch (error) {
    console.error("Error moderating message:", error);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}
