import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import {
  canAccessChannel,
  normalizeChannelAudience,
  requireStaffOrLecturer,
  CHANNEL_AUDIENCE_LABELS,
  type ChannelAudience,
} from "@/lib/staff-channels";

export const dynamic = "force-dynamic";

/**
 * The four channels the handbook names as standing infrastructure, not
 * one-off sends: Admin staff, Tutors, a Growth Desk team channel, and one
 * company-wide. Created once, lazily — the same idempotent-on-first-use
 * shape as ensureDailyOpsTasks in src/lib/growth/tasks.ts — so nobody ever
 * opens this page to an empty "no channels yet" with no way forward.
 */
const DEFAULT_CHANNELS: Array<{ name: string; description: string; audience: ChannelAudience }> = [
  { name: "Admin Staff", description: "Office-wide coordination and announcements.", audience: "admin" },
  { name: "Tutors", description: "For tutors, with HR and Digital Communications keeping a read on it.", audience: "tutors" },
  { name: "Growth Desk Team", description: "Sales & Business Development.", audience: "growth" },
  { name: "Easyway Community", description: "Everyone — admin staff and tutors.", audience: "all_staff" },
];

async function ensureDefaultChannels(): Promise<void> {
  const existing = await prisma.staffChannel.count();
  if (existing > 0) return;
  await prisma.staffChannel.createMany({
    data: DEFAULT_CHANNELS.map((c) => ({ name: c.name, description: c.description, audience: c.audience })),
  });
}

/** GET — every channel the signed-in tutor or admin can open, with a preview of the last message. */
export async function GET() {
  const gate = await requireStaffOrLecturer();
  if (!gate.ok) return gate.response;

  await ensureDefaultChannels();

  const channels = await prisma.staffChannel.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { author: { select: { name: true } } },
      },
    },
  });

  const reachable = channels.filter((c) => {
    const audience = normalizeChannelAudience(c.audience);
    return audience ? canAccessChannel(audience, gate.viewer) : false;
  });

  return NextResponse.json({
    channels: reachable.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      audience: c.audience,
      audienceLabel: CHANNEL_AUDIENCE_LABELS[c.audience as keyof typeof CHANNEL_AUDIENCE_LABELS] ?? c.audience,
      lastMessage: c.messages[0]
        ? { body: c.messages[0].body, authorName: c.messages[0].author?.name ?? null, createdAt: c.messages[0].createdAt }
        : null,
    })),
    // Only an admin holding `community` (the Digital Communications seat)
    // can create new channels — a tutor opening this page sees the list
    // but never the "new channel" control.
    canCreate: gate.viewer.kind === "admin" && gate.viewer.admin.can("community"),
  });
}

/** POST — create a channel. The Digital Communications function: `community` capability. */
export async function POST(req: NextRequest) {
  const gate = await requireCapability("community");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const { name, description, audience } = (body || {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }
  const normalizedAudience = normalizeChannelAudience(audience);
  if (!normalizedAudience) {
    return NextResponse.json({ error: "Unrecognised audience" }, { status: 400 });
  }

  const channel = await prisma.staffChannel.create({
    data: {
      name: name.trim(),
      description: typeof description === "string" ? description.trim() || null : null,
      audience: normalizedAudience,
      createdById: gate.admin.userId,
    },
  });

  return NextResponse.json({ ok: true, channelId: channel.id });
}
