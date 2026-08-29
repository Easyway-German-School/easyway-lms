import { NextRequest, NextResponse } from "next/server";
import { createResetToken } from "@/lib/password-reset";
import { queueEmail } from "@/lib/email-queue";
import { passwordResetEmailTemplate } from "@/lib/email-templates";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

/**
 * "I have forgotten my password."
 *
 * The response is identical whether or not the address belongs to anybody.
 * That is not politeness — a differing response turns this endpoint into a
 * membership oracle: feed it a leaked address list and it tells you which of
 * those people are students at this school, which is exactly the sort of thing
 * the people on that list would object to.
 */

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);

  /**
   * Two counters again, and the per-email one matters more here than it does
   * on sign-in. Without it, anybody who knows a student's address can send
   * that student a reset email every second — the endpoint becomes a way to
   * bomb someone's inbox using our mail reputation to do it.
   */
  const byIp = checkRateLimit(`pwreset:ip:${ip}`, { windowMs: 60 * 60 * 1000, max: 20 });
  if (!byIp.ok) {
    return rateLimitResponse(byIp, "Too many password reset requests. Please try again later.");
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  /**
   * A malformed request gets the same cheerful answer as a good one, for the
   * same reason: any distinguishable response is information.
   */
  const accepted = NextResponse.json({
    message: "If that address has an account, a reset link is on its way.",
  });

  if (!email || !email.includes("@")) return accepted;

  const byEmail = checkRateLimit(`pwreset:email:${email}`, {
    windowMs: 60 * 60 * 1000,
    max: 5,
  });
  if (!byEmail.ok) return accepted;

  try {
    const issued = await createResetToken(email, ip);

    // No account. Say nothing different.
    if (!issued) return accepted;

    const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
    const link = `${base}/auth/reset?token=${encodeURIComponent(issued.token)}`;
    const template = passwordResetEmailTemplate(issued.name, link);

    /**
     * Queued rather than sent inline. The queue survives a mail provider being
     * down or unconfigured, and drains when one exists — which matters
     * particularly here, because a reset email that silently failed to send
     * leaves somebody locked out with no way to tell that anything went wrong.
     *
     * identity "support" because a person who cannot get in may well reply to
     * it, and that reply should reach somebody.
     */
    await queueEmail({
      to: email,
      subject: template.subject,
      html: template.html,
      type: "password_reset",
      identity: "support",
    });
  } catch (error) {
    /**
     * Logged, not surfaced. The caller still gets the same message: an error
     * here is ours to fix, and telling an anonymous caller that this address
     * specifically caused a failure is another way of confirming it exists.
     */
    console.error("Password reset request failed:", error);
  }

  return accepted;
}
