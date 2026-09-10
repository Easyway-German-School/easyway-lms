import { NextRequest, NextResponse } from "next/server";
import { createResetToken } from "@/lib/password-reset";
import { queueEmail } from "@/lib/email-queue";
import { passwordResetEmailTemplate } from "@/lib/email-templates";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { setTenantScope } from "@/lib/tenant/context";
import { resolveTenantId } from "@/lib/tenant/resolve";

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
    /**
     * Which school this reset belongs to, from the hostname it arrived on —
     * exactly as the public signup route does it, and for the same reason.
     *
     * This runs before anyone is signed in, so there is no session to carry a
     * tenant. `queueEmail` writes to `EmailMessage` (and reads `EmailSuppression`
     * on the way), both tenant-owned tables, so with no tenant in context the
     * isolation layer throws `TenantIsolationError` — which the catch below then
     * swallowed. The reset token was still minted, the caller still saw "check
     * your email", and the mail was never queued: every "forgot password sends
     * nothing" report traces to here. The user lookup itself is on the global
     * `User` table and is unaffected; this only puts a tenant on the queued mail.
     */
    setTenantScope(await resolveTenantId(request));

    const issued = await createResetToken(email, ip);

    // No account. Say nothing different.
    if (!issued) return accepted;

    /**
     * The link's host, and why this list is what it is.
     *
     * This used to read `NEXT_PUBLIC_APP_URL || APP_URL` — and `APP_URL` is set
     * nowhere in this project, while `NEXT_PUBLIC_APP_URL` is not in
     * `.env.example` and was not set on the deploy. So `base` came out `""`, the
     * link came out `/auth/reset?token=…` with no scheme or host, and the reset
     * email arrived carrying a dead link. Every other mail builder in the
     * codebase already falls back to `NEXTAUTH_URL` (which any working NextAuth
     * deploy must set); this one now matches them.
     */
    const base = (
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      process.env.APP_URL ||
      ""
    )
      .trim()
      .replace(/\/$/, "");

    if (!base) {
      /**
       * No host to build an absolute link from. Sending the mail anyway would
       * put a broken link in front of somebody already locked out — worse than
       * nothing, because it looks like the feature and teaches them it fails.
       * Log loudly instead so the missing config is visible, and give the
       * caller the same neutral answer as always.
       */
      console.error(
        "Password reset: neither NEXT_PUBLIC_APP_URL nor NEXTAUTH_URL is set, so the reset link would have no host. Not sending. Set one of these on the deployment.",
      );
      return accepted;
    }

    const link = `${base}/auth/reset?token=${encodeURIComponent(issued.token)}`;
    const template = passwordResetEmailTemplate(issued.name, link);

    /**
     * Queued rather than sent inline. The queue survives a mail provider being
     * down or unconfigured, and drains when one exists — which matters
     * particularly here, because a reset email that silently failed to send
     * leaves somebody locked out with no way to tell that anything went wrong.
     *
     * identity "noreply", matching the admin-triggered reset in
     * `lib/student-password-reset-email.ts` and every other student-facing
     * mail. This was "support" on the theory that a locked-out person might
     * reply — but "support" sends as `support@<MAIL_DOMAIN>`, and if that
     * address is not a verified sender with the mail provider the whole send is
     * rejected while every `noreply@` mail (registration, welcome, admin reset)
     * goes out fine. That asymmetry is the "registration email works, reset
     * doesn't" report. `noreply` still carries `replyTo: SUPPORT_ADDRESS`, so a
     * reply still reaches the office — the reason for "support" is kept without
     * the address that was failing.
     */
    await queueEmail({
      to: email,
      subject: template.subject,
      html: template.html,
      type: "password_reset",
      identity: "noreply",
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
