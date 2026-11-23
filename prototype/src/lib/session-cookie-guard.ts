/**
 * Stop `/api/auth/session` from deleting a session cookie that is perfectly good.
 *
 * next-auth v4's session route has one catch block for everything it does:
 * decode the cookie, run the `jwt` and `session` callbacks, re-encode. Any
 * exception anywhere in that chain — a callback that throws, an encode that
 * fails, an `events.session` hook — makes it push a Set-Cookie that CLEARS the
 * session cookie and answer 200 with `{}`. To the browser that is
 * indistinguishable from "you are signed out", it is permanent (the cookie is
 * gone; no retry brings it back), it logs no 5xx, and it hits every user whose
 * page happens to ask while the fault lasts — which is "everyone, at once".
 *
 * A cookie that DECODES is, by definition, not the problem. If the response is
 * about to clear a cookie the request carried and that decodes fine, the clear
 * was caused by a server-side fault, not by the person's session being invalid.
 * This turns that response into a 503 with no Set-Cookie: the cookie survives,
 * the client's check treats a 503 as "unreachable" and asks again, and the
 * fault is reported so it can be found.
 *
 * A cookie that does NOT decode (expired, tampered, signed with an old secret)
 * is passed through untouched — clearing it is the right outcome.
 */

const SESSION_COOKIE = /(^|\s|;)(__Secure-)?next-auth\.session-token(\.\d+)?=/;

function readSetCookies(response: Response): string[] {
  if (typeof response.headers.getSetCookie === "function") {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) return cookies;
  }
  const raw = response.headers.get("set-cookie");
  return raw ? [raw] : [];
}

/** True when the session route answered "there is no session". */
async function emptySessionBody(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  try {
    const body: unknown = await response.clone().json();
    return !body || typeof body !== "object" || Object.keys(body as object).length === 0;
  } catch {
    return false;
  }
}

/** Does this Set-Cookie header delete a session-token cookie? */
export function clearsSessionCookie(setCookie: string): boolean {
  if (!/^\s*(__Secure-)?next-auth\.session-token(\.\d+)?=/.test(setCookie)) return false;
  const emptyValue = /^\s*[^=]+=\s*(;|$)/.test(setCookie);
  const expired = /max-age\s*=\s*0\b/i.test(setCookie) || /expires\s*=\s*thu,\s*01 jan 1970/i.test(setCookie);
  return emptyValue || expired;
}

export function requestCarriesSessionCookie(cookieHeader: string | null): boolean {
  return Boolean(cookieHeader && SESSION_COOKIE.test(cookieHeader));
}

export type GuardResult =
  | { action: "pass" }
  | { action: "replace"; response: Response; reason: string };

/**
 * Decide what to do with the response to a GET /api/auth/session.
 * `cookieDecodes` is only called when it matters, so the common path (nothing
 * is being cleared) costs nothing.
 */
export async function guardSessionResponse(input: {
  method: string;
  pathname: string;
  cookieHeader: string | null;
  response: Response;
  cookieDecodes: () => Promise<boolean>;
}): Promise<GuardResult> {
  const { method, pathname, cookieHeader, response } = input;
  if (method !== "GET" || !pathname.endsWith("/api/auth/session")) return { action: "pass" };
  if (!requestCarriesSessionCookie(cookieHeader)) return { action: "pass" };

  const setCookies = readSetCookies(response);
  const clearing = setCookies.some(clearsSessionCookie);
  // An empty 200 is what the browser treats as "signed out". NextAuth does
  // that both by clearing the cookie and, when the clear header is not
  // visible to getSetCookie, by returning {} alone. A cookie that still
  // decodes is not a sign-out either way.
  const empty = clearing ? false : await emptySessionBody(response);
  if (!clearing && !empty) return { action: "pass" };

  let decodes = false;
  try {
    decodes = await input.cookieDecodes();
  } catch {
    decodes = false;
  }
  if (!decodes) return { action: "pass" };

  return {
    action: "replace",
    reason: "the session route tried to clear a session cookie that decodes fine",
    response: new Response(JSON.stringify({ error: "session_temporarily_unavailable" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-cache, no-store",
        "Retry-After": "2",
      },
    }),
  };
}
