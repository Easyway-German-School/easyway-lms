import { NextRequest, NextResponse } from "next/server";
import { consumeResetToken, passwordProblem } from "@/lib/password-reset";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

/**
 * "Here is the link from my email, and my new password."
 *
 * Unlike the request endpoint, this one does distinguish its failures — a
 * person staring at an expired link needs to be told it is expired, or they
 * will retype the same password four times and conclude the site is broken.
 * Nothing here reveals whether an account exists, only whether this particular
 * token is usable, which the holder of the token already knows.
 */

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);

  /**
   * The tokens are 32 random bytes, so guessing is not a realistic attack.
   * This is here for the unrealistic one, and to stop a script grinding
   * bcrypt hashes on our CPU by posting rubbish tokens with long passwords.
   */
  const limit = checkRateLimit(`pwset:ip:${ip}`, { windowMs: 15 * 60 * 1000, max: 20 });
  if (!limit.ok) {
    return rateLimitResponse(limit, "Too many attempts. Please wait a few minutes and try again.");
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!token) {
    return NextResponse.json({ error: "This reset link is not valid." }, { status: 400 });
  }

  const problem = passwordProblem(password);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const result = await consumeResetToken(token, password);

  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "This reset link has expired. Please request a new one."
        : result.reason === "used"
          ? "This reset link has already been used. Please request a new one."
          : "This reset link is not valid. Please request a new one.";

    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({
    message: "Your password has been changed. You can now sign in.",
  });
}
