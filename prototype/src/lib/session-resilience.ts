/**
 * Why a live class used to throw everybody out, and the guard against it.
 *
 * next-auth's browser client treats ANY failure of `GET /api/auth/session` — a
 * dropped connection, a 5xx while the server is busy or mid-deploy, a 429 — as
 * "there is no session". `useSession()` then flips to `unauthenticated`, and
 * every portal shell answers that by redirecting to the sign-in page. The
 * cookie is still perfectly valid; the page just misread a hiccup as a sign-out.
 * A live classroom is exactly when that hiccup is most likely (everyone has the
 * tab focused, and focus triggers a session re-check) and exactly when it costs
 * the most.
 *
 * So the session request is wrapped, once, in the browser:
 *   1. a failed or throttled request is retried with a short backoff;
 *   2. if it still fails, the last session we KNEW to be good is served instead
 *      of "signed out";
 *   3. if the server really answers "no session" while a live class is open, it
 *      is asked again a few times before it is believed, and if it still says so
 *      the last good session is kept on screen and `LiveSessionRecovery` takes
 *      over (it re-checks quietly and offers a one-tap sign-back-in) so the
 *      class itself is never torn down.
 *
 * An intentional sign-out (POST /api/auth/signout) switches all of this off, so
 * the Sign out button behaves exactly as before.
 */

export const SESSION_LOST_EVENT = "ew:session-lost";
export const SESSION_RESTORED_EVENT = "ew:session-restored";

const SESSION_PATH = "/api/auth/session";
const SIGNOUT_PATH = "/api/auth/signout";

type State = {
  installed: boolean;
  originalFetch: typeof fetch | null;
  lastGood: string | null;
  liveActive: boolean;
  intentionalSignOut: boolean;
  lost: boolean;
};

const state: State = {
  installed: false,
  originalFetch: null,
  lastGood: null,
  liveActive: false,
  intentionalSignOut: false,
  lost: false,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function urlOf(input: RequestInfo | URL): string {
  try {
    if (typeof input === "string") return new URL(input, window.location.origin).pathname;
    if (input instanceof URL) return input.pathname;
    return new URL(input.url, window.location.origin).pathname;
  } catch {
    return "";
  }
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET") ?? "GET").toUpperCase();
}

function hasUser(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return Boolean(parsed && typeof parsed === "object" && parsed.user);
  } catch {
    return false;
  }
}

function synthetic(text: string): Response {
  return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
}

function setLost(lost: boolean) {
  if (state.lost === lost) return;
  state.lost = lost;
  window.dispatchEvent(new Event(lost ? SESSION_LOST_EVENT : SESSION_RESTORED_EVENT));
}

/** Called by the live-call context so the guard knows a class is open. */
export function setLiveActive(active: boolean) {
  state.liveActive = active;
  if (!active) setLost(false);
}

export function isSessionLost(): boolean {
  return state.lost;
}

/**
 * Ask the server about the session directly, bypassing the stand-in. True only
 * if it really answers with a signed-in user.
 */
export async function probeSession(): Promise<boolean> {
  const doFetch = state.originalFetch ?? fetch;
  try {
    const res = await doFetch(SESSION_PATH, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return false;
    const text = await res.text();
    if (hasUser(text)) {
      state.lastGood = text;
      setLost(false);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function resilientSessionFetch(
  original: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const backoff = [700, 1800, 4000];
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= backoff.length; attempt += 1) {
    if (attempt > 0) await sleep(backoff[attempt - 1]);
    try {
      const res = await original(input, init);
      if (res.status >= 500 || res.status === 429) {
        lastResponse = res;
        continue;
      }
      if (!res.ok) return res;

      const text = await res.clone().text();
      if (hasUser(text)) {
        state.lastGood = text;
        setLost(false);
        return res;
      }

      // "No session". Believe it straight away unless a live class is open and
      // we had a good session a moment ago — then insist on a few more looks.
      const doubtful = state.liveActive && state.lastGood && !state.intentionalSignOut;
      if (!doubtful) {
        state.lastGood = null;
        return res;
      }
      if (attempt < backoff.length) continue;

      // Still "no session" after repeated asks, mid-class: keep the screen and
      // the class alive, and let the recovery banner take it from here.
      setLost(true);
      return synthetic(state.lastGood as string);
    } catch (error) {
      lastError = error;
    }
  }

  // The server never gave a usable answer. That is not a sign-out.
  if (state.lastGood && !state.intentionalSignOut) return synthetic(state.lastGood);
  if (lastResponse) return lastResponse;
  throw lastError ?? new Error("Could not reach the session service");
}

/** Install once, in the browser. Safe to call repeatedly. */
export function installSessionResilience() {
  if (typeof window === "undefined" || state.installed) return;
  state.installed = true;
  const original = window.fetch.bind(window);
  state.originalFetch = original;

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const path = urlOf(input);
    const method = methodOf(input, init);

    if (path === SIGNOUT_PATH && method === "POST") {
      state.intentionalSignOut = true;
      state.lastGood = null;
      setLost(false);
      return original(input, init);
    }

    if (path === SESSION_PATH && method === "GET") {
      return resilientSessionFetch(original, input, init);
    }

    return original(input, init);
  };
}
