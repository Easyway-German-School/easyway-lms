import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeMessage, isStaffRole } from "@/lib/community-spaces";
import { canModerate, minutesForPreset } from "@/lib/community-moderation";
import { notifyInBackground, KIND } from "@/lib/notify";

/**
 * The office acting on a room: pinning a message, or muting a student.
 *
 * One route for both because they share the only thing that matters here —
 * the caller must be staff, and the thing being acted on must be inside a room
 * that staff can actually see. Splitting them would duplicate that check,
 * which is the check worth never duplicating.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const viewer = {
    userId: session.user.id as string,
    role: (session.user as { role?: string }).role ?? "",
  };

  if (!canModerate(viewer.role)) {
    return NextResponse.json({ error: "Staff only" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    /* ---------------------------------------------------------------- pin */
    if (action === "pin" || action === "unpin") {
      const messageId = String(body?.messageId ?? "");
      if (!messageId) {
        return NextResponse.json({ error: "messageId is required" }, { status: 400 });
      }

      // Same membership check as every other community write: staff see every
      // room, but the id still has to resolve to one.
      const message = await authorizeMessage(viewer, messageId);
      if (!message) {
        return NextResponse.json({ error: "No such message" }, { status: 403 });
      }

      const pinning = action === "pin";
      await prisma.message.update({
        where: { id: messageId },
        data: {
          pinnedAt: pinning ? new Date() : null,
          pinnedById: pinning ? viewer.userId : null,
        },
      });

      return NextResponse.json({ messageId, pinned: pinning });
    }

    /* --------------------------------------------------------------- mute */
    if (action === "mute" || action === "unmute") {
      const targetUserId = String(body?.userId ?? "");
      if (!targetUserId) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
      }

      const target = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, role: true, name: true, tenantId: true },
      });
      if (!target) {
        return NextResponse.json({ error: "No such member" }, { status: 404 });
      }

      /**
       * Staff cannot be muted, and neither can you mute yourself.
       *
       * Not politeness — a tutor silenced in their own class group cannot run
       * the lesson, and this endpoint is reachable by every tutor in the
       * school. "Ultimate power" over a room has to stop at the people
       * responsible for it, or one bad afternoon takes a colleague off the air.
       */
      if (isStaffRole(target.role)) {
        return NextResponse.json({ error: "Staff cannot be muted." }, { status: 400 });
      }
      if (target.id === viewer.userId) {
        return NextResponse.json({ error: "You cannot mute yourself." }, { status: 400 });
      }

      if (action === "unmute") {
        await prisma.communityMute.deleteMany({ where: { userId: target.id } });
        return NextResponse.json({ userId: target.id, muted: false });
      }

      const minutes = minutesForPreset(String(body?.duration ?? ""));
      if (!minutes) {
        return NextResponse.json({ error: "Pick how long the mute lasts." }, { status: 400 });
      }

      const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) || null : null;
      const mutedUntil = new Date(Date.now() + minutes * 60_000);

      // Upsert, so re-muting moves the end time instead of stacking mutes
      // nobody can reason about.
      await prisma.communityMute.upsert({
        where: { userId: target.id },
        update: { mutedUntil, reason, mutedById: viewer.userId },
        create: {
          userId: target.id,
          mutedUntil,
          reason,
          mutedById: viewer.userId,
          tenantId: target.tenantId ?? null,
        },
      });

      /**
       * The student is TOLD. A silence they have to discover by trying to
       * speak, and then guess the reason for, is how a moderation action
       * becomes a grievance.
       */
      notifyInBackground({
        to: { userIds: [target.id] },
        kind: KIND.announcement,
        severity: "warning",
        title: "You have been muted in the community",
        message: reason
          ? `You cannot post until ${mutedUntil.toLocaleString("en-GB")}. Reason: ${reason}`
          : `You cannot post until ${mutedUntil.toLocaleString("en-GB")}.`,
        link: "/community",
        senderId: viewer.userId,
      });

      return NextResponse.json({
        userId: target.id,
        muted: true,
        mutedUntil: mutedUntil.toISOString(),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Community moderation failed:", error);
    return NextResponse.json({ error: "That did not work" }, { status: 500 });
  }
}
