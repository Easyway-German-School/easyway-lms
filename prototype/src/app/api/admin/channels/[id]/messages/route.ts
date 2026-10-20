import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessChannel, normalizeChannelAudience, requireStaffOrLecturer, type ChannelAudience } from "@/lib/staff-channels";
import { notify, KIND, type NotifyTarget } from "@/lib/notify";

export const dynamic = "force-dynamic";

async function loadAccessibleChannel(id: string, viewer: Parameters<typeof canAccessChannel>[1]) {
  const channel = await prisma.staffChannel.findUnique({ where: { id }, select: { id: true, name: true, audience: true } });
  if (!channel) return { ok: false as const, status: 404, error: "Channel not found" };

  const audience = normalizeChannelAudience(channel.audience);
  if (!audience || !canAccessChannel(audience, viewer)) {
    return { ok: false as const, status: 403, error: "You do not have access to this channel" };
  }
  return { ok: true as const, channel, audience };
}

/**
 * Who a channel's audience maps to in notify()'s vocabulary, each paired
 * with the right portal for the link — a tutor who taps a push for an
 * admin-routed URL hits a gate they cannot pass. "all_staff" has no single
 * NotifyTarget shape — admins and tutors are different role tables — so it
 * is two sends, not one.
 */
function notifyTargetsForAudience(audience: ChannelAudience, channelId: string): Array<{ to: NotifyTarget; link: string }> {
  const adminLink = `/admin/channels?open=${channelId}`;
  const tutorLink = `/lecturer/channels?open=${channelId}`;
  switch (audience) {
    case "admin":
      return [{ to: { audience: "admin" }, link: adminLink }];
    case "tutors":
      return [{ to: { audience: "lecturer" }, link: tutorLink }];
    case "growth":
      return [{ to: { audience: "admin", capability: "growth" }, link: adminLink }];
    case "all_staff":
      return [
        { to: { audience: "admin" }, link: adminLink },
        { to: { audience: "lecturer" }, link: tutorLink },
      ];
  }
}

/** GET — a channel's messages, oldest first (a bulletin board, read top to bottom). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireStaffOrLecturer();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const access = await loadAccessibleChannel(id, gate.viewer);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const messages = await prisma.staffChannelMessage.findMany({
    where: { channelId: id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, email: true } } },
    take: 500,
  });

  return NextResponse.json({ messages });
}

/** POST — post a message. Same access check as reading it. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireStaffOrLecturer();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const access = await loadAccessibleChannel(id, gate.viewer);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => null);
  const { body: text } = (body || {}) as Record<string, unknown>;
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "A message body is required" }, { status: 400 });
  }

  const message = await prisma.staffChannelMessage.create({
    data: { channelId: id, authorId: gate.viewer.userId, body: text.trim() },
  });

  /**
   * THE PHONE PUSH. This is the actual point of the feature — a staff
   * channel nobody's phone buzzes for is just a worse WhatsApp with no
   * notifications, which defeats the entire reason to build it instead of
   * leaning harder on WhatsApp. Every member of the channel's audience
   * gets the bell AND the push; best-effort, so a notify hiccup never
   * costs the message itself, which is already safely saved above.
   */
  try {
    const author = await prisma.user.findUnique({ where: { id: gate.viewer.userId }, select: { name: true } });
    const preview = text.trim().slice(0, 140);
    for (const { to, link } of notifyTargetsForAudience(access.audience, id)) {
      await notify({
        to,
        kind: KIND.announcement,
        severity: "info",
        title: `${access.channel.name}: ${author?.name ?? "New message"}`,
        message: preview,
        link,
        senderId: gate.viewer.userId,
        push: true,
      });
    }
  } catch (error) {
    console.warn("staff channels: notify failed", error);
  }

  return NextResponse.json({ ok: true, messageId: message.id });
}
