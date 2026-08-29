import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { isPlatformHost } from "@/lib/platform/brand";

/**
 * The outermost layer: headers on every response, and a brake on the routes
 * worth attacking.
 *
 * Runs on Vercel's edge, before any page or handler, which is what makes it
 * the right place for rules that must not depend on a route remembering to
 * apply them.
 */

/* -------------------------------------------------------------------------- */
/* Portal gating                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Until this, "no middleware.ts exists" meant every portal's protection was
 * whatever its Shell component happened to do client-side: a `useSession()`
 * check that runs after the page has already shipped its JS, or — for
 * `/admin/**`, which has no shell-level check at all — nothing before the
 * page renders, with only the `/api/admin/*` handlers underneath ever
 * refusing an unauthorised visitor. This closes that at the edge, for the
 * three portals that live under one clean URL prefix each.
 *
 * `/student` deliberately has no entry here. Its pages are shared top-level
 * routes (`/dashboard`, `/calendar`, `/community`, `/live`, ...) also used by
 * other roles via `PortalShell`'s own dispatch, so there is no single prefix
 * or role list to gate here without duplicating that dispatch logic. That
 * portal keeps its existing page-level check for now.
 *
 * This is a fast-path reject, not the authority. Every route still calls
 * `requireAuthSession()` (or the Shell's own `useSession()`), and that
 * remains the source of truth — it does the DB-backed tenant scoping this
 * edge check cannot do, and it is the only place that catches a lecturer
 * revoked mid-session: that downgrade happens in the `session` callback
 * (a Prisma lookup keyed off the *raw* role), not in the JWT this reads, so
 * an inactive tutor's token still says "lecturer" here and clears this gate.
 * Nothing downstream regresses — `requireAuthSession()` and every Shell's
 * `useSession()` still see the downgraded role and refuse them exactly as
 * before. What this gate reliably stops at the edge is the cheaper, more
 * common case: no session at all, or a session for the wrong portal.
 */
type PortalRule = {
  pagePattern: RegExp;
  apiPattern: RegExp;
  allowedRoles: string[];
  signInPath: string;
};

const PORTALS: PortalRule[] = [
  { pagePattern: /^\/admin(\/|$)/, apiPattern: /^\/api\/admin(\/|$)/, allowedRoles: ["admin"], signInPath: "/auth/admin" },
  {
    pagePattern: /^\/lecturer(\/|$)/,
    apiPattern: /^\/api\/lecturer(\/|$)/,
    allowedRoles: ["lecturer", "tutor", "admin"],
    signInPath: "/auth/lecturer/signin",
  },
  { pagePattern: /^\/parent(\/|$)/, apiPattern: /^\/api\/parent(\/|$)/, allowedRoles: ["parent"], signInPath: "/auth/parent/signin" },
  /**
   * The operator console. Its own prefix, outside `/admin/**`, and — unlike
   * `/api/admin/**` — `/api/platform/**` previously had no edge gate at all;
   * every route relied solely on requirePlatformOperator() inside the
   * handler. `allowedRoles` only checks the coarse "admin" role here, same as
   * `/admin` above; requirePlatformOperator() remains the one that checks the
   * actual platformRole column and 404s a non-operator admin.
   *
   * Only `/platform/console/**` is gated, NOT `/platform` itself: that path is
   * now the public EduPrime marketing site. `/api/platform/enquiry` is the one
   * public API under the prefix (the demo-request form) and is excluded below.
   */
  { pagePattern: /^\/platform\/console(\/|$)/, apiPattern: /^\/api\/platform(\/|$)/, allowedRoles: ["admin"], signInPath: "/auth/admin" },
];

/**
 * Public routes that sit under a gated prefix. `/api/platform/enquiry` takes an
 * unauthenticated POST from the EduPrime marketing site's "book a demo" form —
 * it writes nothing tenant-owned, only logs the enquiry and pings a webhook.
 */
const PUBLIC_UNDER_GATED_PREFIX = [/^\/api\/platform\/enquiry(\/|$)/];

// Mirrors lib/auth.ts's normalizeRole(). Not imported from there: that file
// pulls in Prisma and bcrypt, which have no place in an edge bundle.
const normalizeRole = (value: unknown) => String(value || "student").toLowerCase();

/**
 * The one legitimate call to `/api/admin/**` made with a non-admin token:
 * ending an act-as-student session restores the admin's own cookie, and by
 * construction it is called while that cookie holds the STUDENT's token (see
 * src/lib/impersonation.ts). It authenticates itself — decoding the cookie
 * and requiring a valid `impersonatorToken` claim — so it does not need, and
 * must not receive, the role check below.
 */
const IMPERSONATION_END_PATH = "/api/admin/impersonate/end";

async function guardPortal(request: NextRequest, path: string): Promise<NextResponse | null> {
  if (path === IMPERSONATION_END_PATH) return null;
  if (PUBLIC_UNDER_GATED_PREFIX.some((p) => p.test(path))) return null;

  const portal = PORTALS.find((p) => p.pagePattern.test(path) || p.apiPattern.test(path));
  if (!portal) return null;

  /**
   * secureCookie must be forced, not inferred.
   *
   * getToken() defaults to checking whether NEXTAUTH_URL starts with
   * "https://" to decide which cookie name to read — but NEXTAUTH_URL is
   * marked Sensitive in Vercel, and Sensitive env vars are not exposed to
   * the Edge Middleware runtime this file runs in. So that check silently
   * saw `undefined` here and looked for the plain "next-auth.session-token"
   * cookie, while every real sign-in (a Node.js serverless function, where
   * the var IS visible) issues the browser "__Secure-next-auth.session-
   * token". The result: a session that /api/auth/session reports as valid
   * was rejected at this gate on every single request — every admin and
   * lecturer sign-in bounced straight back to the sign-in page it just came
   * from. Deriving it from the request's own protocol instead of an env var
   * makes it correct regardless of what NEXTAUTH_URL is set to or which
   * runtime can see it.
   */
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie: request.nextUrl.protocol === "https:",
  });
  const role = normalizeRole(token?.role);
  // A revoked or admin-locked token carries whatever role it had at issue
  // time; treat it the same way the session callback does — unauthorised,
  // not "whatever role it used to be".
  const authorized =
    Boolean(token?.id) && !token?.revoked && !(token?.adminLocked && role === "admin") && portal.allowedRoles.includes(role);

  if (authorized) return null;

  if (portal.apiPattern.test(path)) {
    return applySecurityHeaders(NextResponse.json({ error: "Not authenticated." }, { status: 401 }));
  }

  const signInUrl = new URL(portal.signInPath, request.url);
  signInUrl.searchParams.set("callbackUrl", path);
  return applySecurityHeaders(NextResponse.redirect(signInUrl));
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                               */
/* -------------------------------------------------------------------------- */

/**
 * BE HONEST ABOUT WHAT THIS IS.
 *
 * The counter lives in the memory of one edge isolate. Vercel runs many, so a
 * determined attacker spreading requests across them gets a higher effective
 * limit than the numbers below suggest, and a cold start forgets everything.
 * It is not a wall.
 *
 * It is still worth having, because the thing it actually stops is the common
 * case: a single script hammering the sign-in endpoint from one address, which
 * is what credential stuffing looks like when it arrives. It turns "unlimited
 * password guesses per second" into something slow enough to be useless, and
 * it costs nothing to run.
 *
 * The upgrade, when the school can justify it, is a shared counter in Upstash
 * Redis — the same rules, one source of truth across isolates. That swap
 * happens inside `hit()` and nowhere else.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

type Rule = { pattern: RegExp; limit: number; windowMs: number; label: string };

const RULES: Rule[] = [
  /**
   * Sign-in. Ten attempts in five minutes is generous for somebody who has
   * genuinely forgotten which password they used, and hopeless for a script.
   */
  { pattern: /^\/api\/auth\/(callback|signin)/, limit: 10, windowMs: 5 * 60_000, label: "sign-in" },

  /**
   * Registration. The abuse here is not a break-in, it is a script creating
   * ten thousand accounts overnight, each of which sends a welcome email from
   * the school's domain and takes its sending reputation down with it.
   */
  { pattern: /^\/api\/auth\/signup/, limit: 5, windowMs: 60 * 60_000, label: "signup" },

  /** Anything that spends money at a model provider. */
  {
    pattern: /^\/api\/(ai|ollama|pronunciation|voice-practice|essay|analyze|recommendations)/,
    limit: 30,
    windowMs: 5 * 60_000,
    label: "ai",
  },

  /** Payment verification, which is both costly and worth probing. */
  { pattern: /^\/api\/(paystack|stripe)/, limit: 20, windowMs: 5 * 60_000, label: "payments" },

  /**
   * The enquiry form is unauthenticated by design — it is the top of the
   * school's funnel — which also makes it the easiest thing on the site to
   * fill with rubbish.
   */
  { pattern: /^\/api\/leads/, limit: 10, windowMs: 60 * 60_000, label: "leads" },
];

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function hit(key: string, rule: Rule): { allowed: boolean; retryAfter: number } {
  const now = Date.now();

  // Opportunistic sweep. Without it a long-lived isolate accumulates one entry
  // per address seen, forever, and the memory limit is reached by bookkeeping.
  if (buckets.size > 5000) {
    for (const [k, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(k);
  }

  const id = `${rule.label}:${key}`;
  const existing = buckets.get(id);

  if (!existing || existing.resetAt < now) {
    buckets.set(id, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > rule.limit) {
    return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/* -------------------------------------------------------------------------- */
/* Headers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The content security policy, assembled from the origins this app actually
 * talks to.
 *
 * It ships in Report-Only unless CSP_ENFORCE is set, and that is a deliberate
 * choice rather than timidity. A policy that is wrong by one origin does not
 * degrade — it blanks the page, breaks the payment popup, or kills the video
 * room, and it does so for everybody at once. Report-Only puts the violations
 * in the browser console where they can be read against a real session, and
 * the flag turns enforcement on once that list is empty. The steps are in
 * docs/SECURITY.md.
 *
 * `frame-ancestors` is the exception and is enforced from the start, through
 * X-Frame-Options below, because clickjacking a school portal into an iframe
 * is a real attack and blocking it cannot break a page that does not frame
 * itself.
 */
function contentSecurityPolicy(): string {
  const media = [
    process.env.STORAGE_PUBLIC_BASE_URL,
    process.env.RECORDING_PUBLIC_BASE_URL,
    process.env.STORAGE_S3_ENDPOINT,
  ].filter(Boolean) as string[];

  const livekit = process.env.LIVEKIT_URL
    ? [process.env.LIVEKIT_URL, process.env.LIVEKIT_URL.replace(/^wss:/, "https:")]
    : [];

  return [
    "default-src 'self'",
    // 'unsafe-inline' and 'unsafe-eval' are what Next's client bootstrap
    // currently needs. Removing them means adopting per-request nonces, which
    // is a worthwhile later step and a real piece of work, not a flag.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co https://checkout.paystack.com",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${media.join(" ")}`,
    `media-src 'self' blob: ${media.join(" ")}`,
    "font-src 'self' data:",
    `connect-src 'self' https://api.paystack.co ${livekit.join(" ")} ${media.join(" ")}`,
    "frame-src 'self' https://checkout.paystack.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ]
    .join("; ")
    .replace(/\s+/g, " ")
    .trim();
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  const headers = response.headers;

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  // Send the origin but never the path to third parties. Paths in this app
  // contain student ids, and referrers leak to every image and script host.
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  /**
   * Camera, microphone and screen share stay allowed for THIS ORIGIN: the live
   * classroom and the signup photo capture both need them. Everything else is
   * off.
   *
   * READ THIS BEFORE EMBEDDING ANY THIRD-PARTY VIDEO OR CAPTURE TOOL.
   *
   * `(self)` means this origin and nothing else. A cross-origin iframe gets no
   * delegation from it — and crucially, the iframe's own `allow="camera;
   * microphone"` attribute cannot grant what the parent policy never gave. The
   * child's getUserMedia then rejects, silently, while everything in that
   * iframe that is only data keeps working perfectly.
   *
   * That is not hypothetical. It is exactly how the first live demo failed: a
   * missing LIVEKIT_URL dropped the school onto an embedded `meet.jit.si`
   * room, this header killed its camera, microphone and screen share, and the
   * chat and hand-raise carried on working — which made it look like a broken
   * video product rather than a two-line configuration error.
   *
   * If a cross-origin embed ever genuinely needs media, name its origin here
   * explicitly, e.g. `camera=(self "https://meet.example.com")`. Do not widen
   * it to `*`.
   */
  headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  headers.set("X-DNS-Prefetch-Control", "off");

  /**
   * Two years, subdomains included. HSTS is the one header here that is hard
   * to take back — a browser that has seen it will refuse plain HTTP for this
   * domain until it expires — so it is set only in production, where the
   * certificate is Vercel's and certain.
   */
  if (process.env.NODE_ENV === "production") {
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  const policy = contentSecurityPolicy();
  headers.set(
    process.env.CSP_ENFORCE === "true"
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only",
    policy,
  );

  return response;
}

/* -------------------------------------------------------------------------- */

/**
 * Named `proxy` in `src/proxy.ts` rather than `middleware` in
 * `src/middleware.ts`. Next 16 renamed this convention and warns on the old
 * one at every boot; the behaviour is identical, and following the rename now
 * means it does not become a broken deploy on a future upgrade.
 */
/**
 * On an EduPrime host, the platform IS the site: `/` is the marketing page and
 * `/console` the operator console, both of which physically live under
 * `/platform/**`. Rewrite (not redirect) so the short URLs stay in the address
 * bar. A school host is untouched — `/` there is still the school's own page.
 *
 * Returns the internal path to serve, or null to leave the request alone.
 */
function platformHostTarget(request: NextRequest, path: string): string | null {
  const raw = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const host = raw.split(":")[0].trim().toLowerCase();
  if (!isPlatformHost(host)) return null;

  if (path === "/" || path === "") return "/platform";
  if (path === "/console" || path === "/console/") return "/platform/console";
  // Already under the real prefix, or an auth/api/asset path — serve as-is.
  return null;
}

export default async function proxy(request: NextRequest) {
  const requestedPath = request.nextUrl.pathname;

  const rewriteTarget = platformHostTarget(request, requestedPath);
  // Gate against the path that will actually be served, so `/console` on an
  // EduPrime host is protected exactly as `/platform/console` is.
  const path = rewriteTarget ?? requestedPath;

  const portalRejection = await guardPortal(request, path);
  if (portalRejection) return portalRejection;

  const rule = RULES.find((candidate) => candidate.pattern.test(path));
  if (rule) {
    const { allowed, retryAfter } = hit(clientKey(request), rule);
    if (!allowed) {
      const response = NextResponse.json(
        {
          error:
            "Too many attempts from this connection. Please wait a moment and try again.",
        },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(retryAfter));
      return applySecurityHeaders(response);
    }
  }

  if (rewriteTarget) {
    const url = request.nextUrl.clone();
    url.pathname = rewriteTarget;
    return applySecurityHeaders(NextResponse.rewrite(url));
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    /**
     * Everything except Next's own static output and the files served straight
     * from disk. Those are immutable assets with no session attached, and
     * putting the middleware in front of them would add latency to every image
     * on every page to no purpose.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|mp4|webm|woff|woff2)$).*)",
  ],
};
