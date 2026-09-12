import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const MAX_MESSAGE = 2000;

/**
 * ONE ASK, UNTIL IT LANDS.
 *
 * Becca asks every student for feedback on the screen after a live class ends.
 * A student who has ever sent one is done — the card never shows again, on any
 * class. A student who hasn't gets asked again next time, and the one after
 * that, for as long as it takes. "Answered" is therefore just "does a row with
 * this kind exist for this user", with no separate per-student flag to keep in
 * sync.
 *
 * Reuses BetaFeedback rather than a new table: this IS a note to the office,
 * filed the same way the general "how's it going" prompt is (see
 * components/BetaFeedbackPrompt.tsx) — just tagged so /admin/beta can tell the
 * two apart. A dedicated route rather than POSTing to /api/beta/feedback
 * because that one also overwrites the student's analytics-consent flag on
 * every call, which this ask has no business touching.
 */
const FEEDBACK_KIND = "live_class";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const answered = await prisma.betaFeedback.findFirst({
    where: { userId: session.user.id, kind: FEEDBACK_KIND },
    select: { id: true },
  });

  return NextResponse.json({ due: !answered });
}

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const message = String(body.message ?? "").trim();
  const rating = Number.isInteger(body.rating) ? Math.min(5, Math.max(1, Number(body.rating))) : null;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 60) : null;
  const sessionTitle = typeof body.sessionTitle === "string" ? body.sessionTitle.trim().slice(0, 120) : null;

  if (!message) return NextResponse.json({ error: "Tell Becca what you think" }, { status: 400 });
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: "Please keep feedback under 2,000 characters" }, { status: 400 });
  }

  const already = await prisma.betaFeedback.findFirst({
    where: { userId: session.user.id, kind: FEEDBACK_KIND },
    select: { id: true },
  });
  if (already) return NextResponse.json({ ok: true, already: true });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { tenantId: true } });
  await prisma.betaFeedback.create({
    data: {
      userId: session.user.id,
      tenantId: user?.tenantId ?? null,
      kind: FEEDBACK_KIND,
      message: rating ? `[${rating}/5] ${message}` : message,
      path: sessionTitle ? `/live · ${sessionTitle}` : sessionId ? `/live/${sessionId}` : "/live",
    },
  });

  return NextResponse.json({ ok: true });
}
