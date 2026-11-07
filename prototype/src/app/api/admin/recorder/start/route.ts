import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { liveWhere } from "@/lib/live-presence";
import { ensureRecordingStarted } from "@/lib/class-recorder";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });

  const session = await prisma.liveClassSession.findFirst({
    where: { id: sessionId, ...liveWhere() },
    select: {
      roomName: true,
      branchId: true,
      level: true,
      sessionSlot: true,
      privateClassId: true,
      startedByUserId: true,
      branch: { select: { name: true } },
      tenantId: true,
    },
  });
  if (!session) return NextResponse.json({ error: "That class is no longer live. Refresh and try again." }, { status: 404 });

  const egressId = await ensureRecordingStarted({
    roomName: session.roomName,
    tenantId: session.tenantId ?? gate.session.user.tenantId ?? null,
    branchId: session.branchId,
    branchName: session.branch?.name ?? null,
    level: session.level,
    sessionSlot: session.sessionSlot,
    startedByUserId: session.startedByUserId,
    privateClassId: session.privateClassId,
  });
  if (!egressId) {
    return NextResponse.json(
      { error: "Recording did not start. Check the recorder and LiveKit status, then try again." },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, recording: true });
}
