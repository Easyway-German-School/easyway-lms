import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { logLeadActivity } from "@/lib/growth/activity";

export const dynamic = "force-dynamic";

/** GET — the full, unrewritable history for one lead. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const activity = await prisma.leadActivity.findMany({
    where: { leadId: id },
    include: { actor: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ activity });
}

/** POST — log a note or a call. The only kinds a rep can write by hand. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { type, note } = (body || {}) as Record<string, unknown>;

  if (type !== "note" && type !== "call") {
    return NextResponse.json({ error: 'type must be "note" or "call"' }, { status: 400 });
  }
  if (typeof note !== "string" || !note.trim()) {
    return NextResponse.json({ error: "note is required" }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  await logLeadActivity({
    leadId: id,
    type,
    payload: { note: note.trim() },
    actorId: gate.admin.userId,
  });

  return NextResponse.json({ ok: true });
}
