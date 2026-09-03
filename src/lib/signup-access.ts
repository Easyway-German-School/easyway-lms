import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { REGISTRATION_FEE } from "@/lib/payment";
import { safeJson } from "@/lib/safe-json";

/**
 * THE GATE ON PUBLIC STUDENT SIGNUP.
 *
 * `/auth/signup` is world-open by URL. Two WordPress enrolment forms send real
 * students here — a returning student with a one-time `token` (minted at POST
 * /api/signup-tokens), a new student with a Paystack `?ref=` after paying the
 * registration fee on the WordPress side. This module is what decides whether a
 * given visitor is one of those two, and it is called from BOTH:
 *
 *   - SignupAccessGate (the page)  — so the form does not render otherwise
 *   - POST /api/auth/signup (the API) — so a direct POST cannot skip the page
 *
 * Server-only: it reads `PAYSTACK_SECRET_KEY` and talks to Paystack. Never
 * import it into a client component.
 *
 * NOTHING here throws for a "blocked" outcome — a bad token, a dud ref, even
 * Paystack being unreachable all return `{ valid: false, reason }`. Failing
 * closed on a Paystack outage is deliberate: a brief "please try again" beats
 * letting the fee-bypass hole reopen whenever Paystack has a wobble.
 */

export type SignupAccessReason =
  | "missing"
  | "not_found"
  | "used"
  | "expired"
  | "ref_unverified"
  | "ref_underpaid"
  | "ref_consumed";

export type SignupAccessPrefill = {
  name?: string;
  email?: string;
  level?: string;
  branchId?: string;
  sessionSlot?: string;
};

export type SignupAccessResult = {
  valid: boolean;
  source: "token" | "ref" | "invite-sig" | null;
  reason?: SignupAccessReason;
  prefill?: SignupAccessPrefill;
  /**
   * The enrolment email this proof was issued for, when known. The signup that
   * spends the proof MUST use this address — enforced in the signup route — so
   * a leaked-but-valid token/ref cannot be redirected onto an arbitrary
   * account. Undefined for a Paystack ref whose charge carried no customer
   * email.
   */
  email?: string;
  /** SignupToken.id for the token path (so the route can mark it used). */
  tokenId?: string;
  /** Echoed back for the ref path (so the route can write the consumption marker). */
  ref?: string;
  /** Paystack charge amount in naira, for the ref path (recorded against the new student). */
  refAmountNaira?: number;
  /** Paystack charge currency, for the ref path. */
  refCurrency?: string;
};

function clean(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

/**
 * Validate a returning-student token OR a new-student Paystack ref. The token
 * is tried first; the ref is only consulted when there is no usable token.
 */
export async function validateSignupAccess({
  token,
  ref,
}: {
  token?: string | null;
  ref?: string | null;
}): Promise<SignupAccessResult> {
  const cleanToken = clean(token);
  const cleanRef = clean(ref);

  if (!cleanToken && !cleanRef) {
    return { valid: false, source: null, reason: "missing" };
  }

  if (cleanToken) {
    const row = await prisma.signupToken.findUnique({ where: { token: cleanToken } });
    if (row) {
      if (row.used) return { valid: false, source: "token", reason: "used" };
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
        return { valid: false, source: "token", reason: "expired" };
      }
      return {
        valid: true,
        source: "token",
        tokenId: row.id,
        email: row.email || undefined,
        prefill: {
          name: row.name || undefined,
          email: row.email || undefined,
          level: row.level || undefined,
          branchId: row.branchId || undefined,
          sessionSlot: row.sessionSlot || undefined,
        },
      };
    }
    // A token that matched nothing and no ref to fall back on.
    if (!cleanRef) return { valid: false, source: "token", reason: "not_found" };
  }

  // Paystack reference (new students who paid the registration fee on WordPress).
  if (cleanRef) {
    // Has this ref already been spent on a signup?
    const [consumedMarker, existingPayment] = await Promise.all([
      prisma.signupToken.findUnique({ where: { paystackRef: cleanRef } }),
      prisma.payment.findFirst({ where: { stripeSessionId: cleanRef }, select: { id: true } }),
    ]);
    if (consumedMarker || existingPayment) {
      return { valid: false, source: "ref", reason: "ref_consumed" };
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      console.error("Signup ref check blocked: PAYSTACK_SECRET_KEY is not set");
      return { valid: false, source: "ref", reason: "ref_unverified" };
    }

    let data: any;
    try {
      const response = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(cleanRef)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
          cache: "no-store",
        },
      );
      data = await safeJson(response);
      if (!response.ok) {
        console.warn("Signup ref check: Paystack verify non-200", { ref: cleanRef, status: response.status });
        return { valid: false, source: "ref", reason: "ref_unverified" };
      }
    } catch (error) {
      console.error("Signup ref check: could not reach Paystack", { ref: cleanRef, error });
      return { valid: false, source: "ref", reason: "ref_unverified" };
    }

    const tx = data?.data;
    if (!tx || tx.status !== "success") {
      return { valid: false, source: "ref", reason: "ref_unverified" };
    }

    const amountNaira = Math.round(Number(tx.amount || 0) / 100);
    if (amountNaira < REGISTRATION_FEE) {
      return { valid: false, source: "ref", reason: "ref_underpaid" };
    }

    const customerEmail = clean(tx.customer?.email)?.toLowerCase();
    const metaName =
      clean(tx.metadata?.name) ||
      [clean(tx.metadata?.first_name), clean(tx.metadata?.last_name)].filter(Boolean).join(" ") ||
      undefined;

    return {
      valid: true,
      source: "ref",
      ref: cleanRef,
      email: customerEmail,
      refAmountNaira: amountNaira,
      refCurrency: clean(tx.currency) || "NGN",
      prefill: { name: metaName, email: customerEmail },
    };
  }

  return { valid: false, source: null, reason: "not_found" };
}

/* -------------------------------------------------------------------------- *
 * Legacy first-party invite links.
 *
 * The office's lead-invite emails (src/lib/leads.ts) and any other first-party
 * generator link to `/auth/signup` with the student's details prefilled. Once
 * the gate is up an UNSIGNED `?email=&name=` link is exactly the hole we are
 * closing, so those links now carry an HMAC `sig` of their own parameters,
 * keyed by a server secret. This is the one sanctioned way past the gate that
 * is not a token or a paid ref.
 * -------------------------------------------------------------------------- */

const INVITE_SIG_FIELDS = ["email", "name", "level", "branchId", "sessionSlot"] as const;
type InviteParams = Partial<Record<(typeof INVITE_SIG_FIELDS)[number], string | null | undefined>>;

function canonicalInvite(params: InviteParams): string {
  return INVITE_SIG_FIELDS.map((key) => {
    const raw = params[key];
    const value = key === "email" ? clean(raw)?.toLowerCase() ?? "" : clean(raw) ?? "";
    return `${key}=${value}`;
  }).join("&");
}

/** Sign a set of invite params. Returns undefined when no secret is configured. */
export function signInviteParams(params: InviteParams): string | undefined {
  const secret = process.env.SIGNUP_INVITE_SIGNING_SECRET;
  if (!secret) return undefined;
  return crypto.createHmac("sha256", secret).update(canonicalInvite(params)).digest("base64url");
}

/** Constant-time check of an invite `sig` against its params. */
export function verifyInviteSig(params: InviteParams, sig: string | null | undefined): boolean {
  const provided = clean(sig);
  if (!provided) return false;
  const expected = signInviteParams(params);
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
