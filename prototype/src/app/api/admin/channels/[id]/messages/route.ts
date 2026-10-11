import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessChannel, normalizeChannelAudience, requireStaffOrLecturer } from "@/lib/staff-channels";

export const dynamic = "force-dynamic";

async function loadAccessibleChannel(id: string, viewer: Parameters<typeof canAccessChannel>[1]) {
  const channel = await prisma.staffChannel.findUnique({ where: { id }, select: { id: true, audience: true } });
  if (!channel) return { ok: false as const, status: 404, error: "Channel not found" };

  const audience = normalizeChannelAudience(channel.audience);
  if (!audience || !canAccessChannel(audience, viewer)) {
    return { ok: false as const, status: 403, error: "You do not have access to this channel" };
  }
  return { ok: true as const, channel };
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

  return NextResponse.json({ ok: true, messageId: message.id });
}
