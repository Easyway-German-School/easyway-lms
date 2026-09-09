import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { requireCapability } from "@/lib/admin-roles";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { liveWhere } from "@/lib/live-presence";
import { missingLiveKitConfig, observerIdentity } from "@/lib/live-classroom";

export const dynamic = "force-dynamic";

/** One audit line per class per this many minutes — see the note by the write below. */
const AUDIT_DEDUPE_MINUTES = 10;

/**
 * A TOKEN FOR WATCHING A LIVE CLASS WITHOUT BEING IN IT.
 *
 * The office's "who is live right now" page (src/app/admin/live/page.tsx) can
 * only ever show metadata — names, join times, whether a camera is muted. The
 * one thing it cannot answer is "what is actually happening in that lesson",
 * and for an online school that is the whole point of having supervisors.
 *
 * This mints a LiveKit token that joins the room to LISTEN. Three deliberate
 * properties, every one of them enforced by the SFU rather than by the UI:
 *
 *   hidden        — LiveKit never fires ParticipantConnected for this join, so
 *                   the tutor's participant count does not move, no arrival
 *                   sound plays, and the observer is in nobody's grid. The
 *                   class sees the room it would have seen anyway.
 *   canPublish:false / canPublishData:false
 *                 — no camera, no microphone, no chat, no reactions, no floor
 *                   messages. There is no client button for any of it, and the
 *                   token would be refused if there were.
 *   no session writes
 *                 — this route never opens a LiveClassSession, never records
 *                   attendance, never starts a recording. Observing leaves no
 *                   trace in the room OR in the class's own records.
 *
 * It is NOT invisible to the school itself: every issue is written to the audit
 * trail with the admin's name on it, deduped to one entry per class per ten
 * minutes exactly the way the student remote-view screen is.
 */
export async function GET(request: NextRequest) {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;
  const { admin } = gate;

  const roomName = request.nextUrl.searchParams.get("room");
  if (!roomName) {
    return NextResponse.json({ error: "Which class? Pass ?room=" }, { status: 400 });
  }

  /**
   * The room must be one of ours and genuinely live right now — the same
   * ownership check the monitor route runs, for the same reason: a room name is
   * a LiveKit identifier, not a credential, and this endpoint must not become a
   * general "mint me a token for any room" proxy.
   */
  const session = await prisma.liveClassSession.findFirst({
    where: { roomName, ...liveWhere() },
    orderBy: { startedAt: "desc" },
    select: { id: true, title: true, roomName: true, branchId: true },
  });
  if (!session) {
    return NextResponse.json({ error: "That class is not live." }, { status: 404 });
  }

  // A branch-scoped admin supervises only their own branches.
  if (admin.branchIds && session.branchId && !admin.branchIds.includes(session.branchId)) {
    return NextResponse.json(
      { error: "That class is at a branch your account does not cover." },
      { status: 403 },
    );
  }

  const missing = missingLiveKitConfig();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `The live classroom is not configured on this deployment — missing ${missing.join(", ")}.` },
      { status: 503 },
    );
  }

  const token = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity: observerIdentity(admin.userId),
    name: "Supervisor",
    // Long enough to sit through a full class; short enough that a copied token
    // is not a standing key to every future lesson in this room.
    ttl: "3h",
    metadata: JSON.stringify({ role: "observer" }),
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    // Both must be spelled out: with NEITHER set, LiveKit enables both.
    canPublish: false,
    canSubscribe: true,
    canPublishData: false,
    canUpdateOwnMetadata: false,
    // The whole point — the room is never told this participant exists.
    hidden: true,
    roomAdmin: false,
  });

  /**
   * ONE ENTRY PER CLASS PER TEN MINUTES, NOT ONE PER FETCH.
   *
   * The observer page re-requests a token on reconnect, and an admin who closes
   * and reopens the panel would otherwise stack identical lines. That does not
   * make the trail more complete — it buries the deliberate act of opening a
   * lesson under a wall of noise, which is the one thing this record exists to
   * show. A fresh entry after ten quiet minutes is a genuine second visit.
   * Mirrors AUDIT_DEDUPE_MINUTES on /api/admin/students/[id]/remote.
   */
  const recentlyLogged = await unguardedPrisma.auditLog.findFirst({
    where: {
      action: "liveObserve",
      model: "LiveClassSession",
      recordId: session.id,
      actorId: admin.userId,
      at: { gte: new Date(Date.now() - AUDIT_DEDUPE_MINUTES * 60_000) },
    },
    select: { id: true },
  });
  if (!recentlyLogged) {
    await writeAudit(unguardedPrisma, {
      action: "liveObserve",
      model: "LiveClassSession",
      recordId: session.id,
      severity: "notice",
      summary: `Silent supervision of "${session.title}" — the class was not notified`,
    });
  }

  return NextResponse.json({
    url: process.env.LIVEKIT_URL,
    token: await token.toJwt(),
    roomName: session.roomName,
    title: session.title,
  });
}
