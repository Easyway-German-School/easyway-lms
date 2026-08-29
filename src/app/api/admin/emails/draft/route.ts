import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { claudeFailureHint, draftEmailBlocks, emailDraftEngines, type EmailDraftEngine } from "@/lib/ai";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * "Write this campaign for me."
 *
 * Returns BLOCKS, which land in the editor as editable rows — it never sends
 * and never queues. An admin still reads it, still reorders it, still presses
 * send. That is the only arrangement in which letting a model near a message
 * bound for three hundred students is reasonable.
 *
 * Gated on the `emails` capability rather than merely on being staff: this
 * spends the school's Claude budget and drafts in the school's voice, which is
 * the bursar's business and not every admin's.
 */

export async function GET() {
  const gate = await requireCapability("emails");
  if (!gate.ok) return gate.response;

  // The composer draws its toggle from this, so an engine that cannot answer
  // is shown disabled with the reason rather than silently returning mock text.
  return NextResponse.json({ engines: emailDraftEngines() });
}

export async function POST(request: Request) {
  const gate = await requireCapability("emails");
  if (!gate.ok) return gate.response;

  const userId = gate.session.user.id as string;
  const limit = checkRateLimit(`email-draft:${userId}`, { windowMs: 60 * 60 * 1000, max: 30 });
  if (!limit.ok) {
    return rateLimitResponse(limit, "That is a lot of drafting in one hour. Try again shortly.");
  }

  const body = await request.json().catch(() => ({}));
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  const engine: EmailDraftEngine =
    body.engine === "claude" || body.engine === "local" ? body.engine : "auto";

  if (brief.length < 10) {
    return NextResponse.json(
      { error: "Say a little more about what this email is for — a sentence is enough." },
      { status: 400 },
    );
  }

  const chosen = emailDraftEngines().find((e) => e.id === engine);
  if (chosen && !chosen.available) {
    return NextResponse.json({ error: `${chosen.label} is not available: ${chosen.detail}` }, { status: 400 });
  }

  const draft = await draftEmailBlocks({
    brief,
    audience: typeof body.audience === "string" ? body.audience.slice(0, 200) : null,
    engine,
  });

  if (!draft) {
    /**
     * 503 rather than 500: nothing is broken, the engine simply did not return
     * anything usable, and whatever the admin already had is untouched.
     *
     * The hint matters. A key that is present but unfunded passes every check
     * this app can make for free, so "Claude" shows as available and then
     * fails — and "try rewording the brief" would send an admin rewriting
     * perfectly good copy to fix a billing problem.
     */
    const hint = engine === "local" ? null : claudeFailureHint();
    return NextResponse.json(
      {
        error: hint
          ? `${hint} Your message is still here.`
          : "The assistant could not draft that. Your message is still here — try rewording the brief.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ draft });
}
