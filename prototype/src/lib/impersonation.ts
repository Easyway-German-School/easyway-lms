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

function secureCookieContext(): boolean {
  return (process.env.NEXTAUTH_URL || "").startsWith("https://");
}

/** Matches next-auth's own default cookie name/prefix — see its src/core/lib/cookie.ts. */
export function sessionCookieName(): string {
  return secureCookieContext() ? "__Secure-next-auth.session-token" : "next-auth.session-token";
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: secureCookieContext(),
    maxAge: maxAgeSeconds,
  };
}
