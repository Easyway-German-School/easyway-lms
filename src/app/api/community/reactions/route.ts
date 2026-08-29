import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeMessage } from "@/lib/community-spaces";
import { ALLOWED_REACTIONS } from "@/lib/community-reactions";

/**
 * Reacting to a message.
 *
 * One endpoint, and it TOGGLES rather than taking an add/remove instruction.
 * A tap is the only gesture the UI has, so the server deciding what a tap
 * means is one fewer thing that can disagree with the screen — and it makes a
 * double-tap on a slow phone idempotent instead of a bug.
 *
 * The emoji is checked against a fixed set. It is a user-supplied string
 * rendered to a whole cohort, so an open field is a way to put arbitrary text
 * into everybody else's chat; the picker offers exactly these and the server
 * accepts exactly these.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const viewer = { userId: session.user.id as string, role: (session.user as { role?: string }).role ?? "" };

  try {
    const body = await request.json();
    const messageId = String(body?.messageId ?? "");
    const emoji = String(body?.emoji ?? "");

    if (!messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }
    if (!ALLOWED_REACTIONS.includes(emoji as (typeof ALLOWED_REACTIONS)[number])) {
      return NextResponse.json({ error: "That is not a reaction you can send" }, { status: 400 });
    }

    /**
     * The same authorisation every other community route uses: the message has
     * to sit in a room this viewer belongs to. Without it, a message id from
     * another sitting would be reactable by anyone who could guess it — the
     * cohort boundary has to hold on every write, not just on the read that
     * lists the rooms.
     */
    const message = await authorizeMessage(viewer, messageId);
    if (!message) {
      return NextResponse.json({ error: "Not your room" }, { status: 403 });
    }

    const existing = await prisma.messageReaction.findFirst({
      where: { messageId, userId: viewer.userId, emoji },
      select: { id: true },
    });

    if (existing) {
      await prisma.messageReaction.delete({ where: { id: existing.id } });
    } else {
      await prisma.messageReaction.create({
        data: {
          messageId,
          userId: viewer.userId,
          emoji,
          // Stamped from the message so a reaction cannot end up in a
          // different school from the thing it reacts to.
          tenantId: message.tenantId ?? null,
        },
      });
    }

    // The fresh fold for this one message, so the bubble can settle without
    // waiting for the next poll.
    const rows = await prisma.messageReaction.findMany({
      where: { messageId },
      select: { emoji: true, userId: true },
    });

    const byEmoji = new Map<string, { emoji: string; count: number; mine: boolean }>();
    for (const row of rows) {
      const entry = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false };
      entry.count += 1;
      if (row.userId === viewer.userId) entry.mine = true;
      byEmoji.set(row.emoji, entry);
    }

    return NextResponse.json({
      messageId,
      reactions: [...byEmoji.values()].sort(
        (a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji),
      ),
    });
  } catch (error) {
    console.error("Community reaction failed:", error);
    return NextResponse.json({ error: "Unable to save that reaction" }, { status: 500 });
  }
}
