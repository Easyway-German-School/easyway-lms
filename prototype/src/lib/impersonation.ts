import type { NextRequest } from "next/server";

/**
 * Act-as-student sessions.
 *
 * Remote view (see src/app/api/admin/students/[id]/remote/route.ts) is
 * deliberately read-only: it exists so admin never has to become a student to
 * see what they see. This is the other tool — the one the office asked for
 * on top of it — for when reading is not enough and someone genuinely needs
 * to act inside the student's account.
 *
 * THE MECHANISM. NextAuth's session is a signed JWT in a cookie; nothing
 * server-side tracks "who is logged in". Starting an act-as session mints a
 * fresh JWT for the student and swaps it into the admin's own cookie — the
 * admin's browser now IS the student's session, exactly as if they had
 * signed in with the student's password. The student's own device is
 * untouched: they keep their own session, on their own phone, and are never
 * signed out or asked to approve anything.
 *
 * GETTING BACK. The admin's original token is folded into the new one as a
 * claim (`impersonatorToken`) rather than kept in a second cookie or a
 * database row, so ending the session is stateless: decode the current
 * cookie, lift that claim back out, and it IS the admin's session again,
 * unexpired, exactly as it stood the moment they switched.
 *
 * SHORT-LIVED ON PURPOSE. A normal sign-in JWT lives 30 days. An act-as
 * session is capped far below that — long enough for one real support task,
 * short enough that a browser tab left open overnight does not stay a live
 * door into a student's account.
 */

export const IMPERSONATION_MAX_AGE_SECONDS = 60 * 60 * 3; // 3 hours

const SECURE_COOKIE_NAME = "__Secure-next-auth.session-token";
const PLAIN_COOKIE_NAME = "next-auth.session-token";

/**
 * Which of the two cookie names next-auth actually used for THIS request,
 * found by asking the browser rather than by re-deriving next-auth's own
 * `useSecureCookies` decision — that decision depends on how next-auth reads
 * the deployment's base URL internally, which is not part of its public API
 * and does not always agree with a simple `NEXTAUTH_URL.startsWith("https")`
 * check. Reading whichever cookie the browser actually sent is exact by
 * construction: it is the same cookie next-auth's own `getServerSession`
 * would have read one line later in the same request.
 *
 * Returns null when neither cookie is present — an unauthenticated request.
 */
export function readSessionCookie(
  request: NextRequest,
): { name: string; value: string; secure: boolean } | null {
  const secure = request.cookies.get(SECURE_COOKIE_NAME);
  if (secure) return { name: SECURE_COOKIE_NAME, value: secure.value, secure: true };
  const plain = request.cookies.get(PLAIN_COOKIE_NAME);
  if (plain) return { name: PLAIN_COOKIE_NAME, value: plain.value, secure: false };
  return null;
}

/**
 * Options for setting a session cookie back. `secure` must match whichever
 * name is being written — pass the value `readSessionCookie` returned for
 * the request this cookie belongs to, not a guess.
 */
export function sessionCookieOptions(secure: boolean, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge: maxAgeSeconds,
  };
}
