import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAiStaff } from "@/lib/ai-guard";
import { draftClassAnnouncement } from "@/lib/ai";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * "Write this properly for me."
 *
 * A drafting aid, not a sender. It returns text into the tutor's form and
 * stops there — the tutor still reads it, still edits it, and still presses
 * send, which is the only reason it is safe to let a model near a message that
 * goes to two hundred students. Nothing here writes a Notification row.
 *
 * The cohort label is read from the tutor's own record rather than the request
 * body, for the same reason the announcement route resolves its audience that
 * way: nothing a client sends should be able to tell the model it is writing
 * to a class the sender does not teach.
 */
export async function POST(request: Request) {
  const gate = await requireAiStaff();
  if (!gate.ok) return gate.response;

  /**
   * Metered per tutor. Each call costs the school money and the honest usage
   * pattern is a handful of drafts while composing one message — twenty an
   * hour is comfortably above that and well below anything that could run up a
   * bill from a page left open on a rewrite loop.
   */
  const limit = checkRateLimit(`announce-draft:${gate.userId}`, {
    windowMs: 60 * 60 * 1000,
    max: 20,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit, "You have drafted a lot in the last hour. Try again shortly.");
  }

  const body = await request.json().catch(() => ({}));
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (notes.length < 5) {
    return NextResponse.json(
      { error: "Jot down what you want to say first — a few words is enough." },
      { status: 400 },
    );
  }

  const lecturer = await prisma.lecturer.findUnique({
    where: { userId: gate.userId },
    select: {
      level: true,
      sessionSlot: true,
      branch: { select: { name: true } },
    },
  });

  const cohortLabel =
    lecturer?.branch?.name && lecturer.level
      ? `${lecturer.branch.name} ${lecturer.level}${lecturer.sessionSlot ? ` ${lecturer.sessionSlot}` : ""}`
      : null;

  const draft = await draftClassAnnouncement({
    notes,
    cohortLabel,
    urgent: body.urgent === true,
  });

  if (!draft) {
    // 503, not 500: nothing is broken, the assistant is simply unavailable —
    // usually no ANTHROPIC_API_KEY — and the tutor's own text is untouched.
    return NextResponse.json(
      { error: "The writing assistant is not available right now. Your message is still here." },
      { status: 503 },
    );
  }

  return NextResponse.json({ draft });
}
