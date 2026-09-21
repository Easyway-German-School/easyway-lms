import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { feedbackDue, saveFeedback } from "@/lib/live-feedback";

export const dynamic = "force-dynamic";

/**
 * "How was that class?" for students and tutors alike. The rules for who is asked
 * about which class, and how often, live in lib/live-feedback.ts.
 *
 *   GET  ?sessionId=…   is THIS class waiting for my rating? (the end-of-class screen)
 *   GET                 which class, if any, is waiting for my rating? (the popup on
 *                       my next visit, for anyone who closed the tab before answering)
 *   POST                file a rating for a class I was in.
 */
export async function GET(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = request.nextUrl.searchParams.get("sessionId") || undefined;
  const due = await feedbackDue(session.user.id, { sessionId });

  if (!due) return NextResponse.json({ due: false });
  return NextResponse.json({
    due: true,
    role: due.role,
    session: { id: due.sessionId, title: due.title, startedAt: due.startedAt },
  });
}

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 60) : "";
  const rating = Number(body.rating);
  const message = typeof body.message === "string" ? body.message : "";

  if (!sessionId) return NextResponse.json({ error: "Which class is this about?" }, { status: 400 });
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Tap a star to rate the class." }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: "Please keep feedback under 2,000 characters." }, { status: 400 });
  }

  const result = await saveFeedback({ userId: session.user.id, sessionId, rating, message });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
