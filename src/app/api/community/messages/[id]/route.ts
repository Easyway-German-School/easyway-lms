import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeMessage, isStaffRole } from "@/lib/community-spaces";

export const dynamic = "force-dynamic";

const MAX_BODY = 4000;

/**
 * Editing and removing a message, and the difference between the two people
 * who can do it.
 *
 * An AUTHOR may fix their own typo and may take their own message back. A
 * MODERATOR may take anybody's message down but may never change what it says —
 * a member of staff who could silently rewrite a student's words would make
 * every transcript in the school worthless as evidence.
 *
 * Neither of them deletes a row. `hiddenAt` is a soft hide, because the moment
 * you most need a record of what was written is the moment somebody has just
 * removed it. Students stop seeing the text immediately; staff keep seeing it,
 * with who hid it and why.
 */

/** PATCH — the author corrects their own message. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await context.params;
    const viewer = { userId: session.user.id as string, role: (session.user as any).role };

    const message = await authorizeMessage(viewer, id);
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });

    // Not "author or staff". Only the author. See the note above.
    if (message.authorId !== viewer.userId) {
      return NextResponse.json({ error: "You can only edit your own messages" }, { status: 403 });
    }
    if (message.hiddenAt) {
      return NextResponse.json({ error: "This message has been removed" }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const text = String(body.body ?? "").trim().slice(0, MAX_BODY);
    if (!text && !message.attachmentUrl) {
      return NextResponse.json({ error: "A message cannot be empty" }, { status: 400 });
    }

    const updated = await prisma.message.update({
      where: { id: message.id },
      // `editedAt` is what lets the bubble admit it changed. A message that can
      // be altered without saying so is one nobody can rely on having read.
      data: { body: text, editedAt: new Date() },
      select: { id: true, body: true, editedAt: true },
    });

    return NextResponse.json({
      message: { id: updated.id, body: updated.body, editedAt: updated.editedAt?.toISOString() ?? null },
    });
  } catch (error) {
    console.error("Community message edit failed:", error);
    return NextResponse.json({ error: "Unable to edit that message" }, { status: 500 });
  }
}

/** DELETE — the author withdraws it, or a moderator takes it down. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await context.params;
    const viewer = { userId: session.user.id as string, role: (session.user as any).role };

    const message = await authorizeMessage(viewer, id);
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });

    const staff = isStaffRole(viewer.role);
    const mine = message.authorId === viewer.userId;
    if (!staff && !mine) {
      return NextResponse.json({ error: "You can only remove your own messages" }, { status: 403 });
    }
    // Already down. Not an error — two moderators can press the same button.
    if (message.hiddenAt) return NextResponse.json({ ok: true, alreadyHidden: true });

    const reason = String(((await request.json().catch(() => ({}))) as any).reason ?? "").slice(0, 300);

    await prisma.message.update({
      where: { id: message.id },
      data: {
        hiddenAt: new Date(),
        hiddenById: viewer.userId,
        hiddenReason: mine && !staff ? "Removed by the author" : reason || "Removed by a moderator",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Community message removal failed:", error);
    return NextResponse.json({ error: "Unable to remove that message" }, { status: 500 });
  }
}
