import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { setTenantScope } from "@/lib/tenant/context";
import { resolveTenantId } from "@/lib/tenant/resolve";
import { OFFERED_LEVELS } from "@/lib/levels";
import { TIME_SLOTS } from "@/lib/class-times";

/**
 * Mint a one-time student-signup token.
 *
 * Called by the WordPress enrolment flow (and any internal tool) to hand a
 * returning student a link that gets them past the `/auth/signup` gate exactly
 * once. New students do not need this — they arrive with a paid Paystack
 * `?ref=` instead — but WordPress may still mint one for them if it prefers a
 * uniform link shape.
 *
 * Auth is a shared secret in the `x-signup-token-key` header, compared
 * constant-time to SIGNUP_TOKEN_MINT_KEY. That is the whole authorization
 * model: anyone holding the key may mint, nobody else can. CORS is open like
 * /api/leads and /api/auth/signup because the caller is another origin.
 */

function buildCorsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin === "*" ? "*" : origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-signup-token-key",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { status: 204, headers: buildCorsHeaders(request) });
}

function keyOk(provided: string | null): boolean {
  const expected = process.env.SIGNUP_TOKEN_MINT_KEY;
  if (!expected) return false;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export async function POST(request: NextRequest) {
  const cors = buildCorsHeaders(request);

  if (!process.env.SIGNUP_TOKEN_MINT_KEY) {
    console.error("Signup-token mint blocked: SIGNUP_TOKEN_MINT_KEY is not set");
    return NextResponse.json(
      { error: "Token minting is not configured." },
      { status: 503, headers: cors },
    );
  }

  if (!keyOk(request.headers.get("x-signup-token-key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: cors });
  }

  const ip = clientIp(request.headers);
  const limit = checkRateLimit(`signup-token:ip:${ip}`, { windowMs: 60 * 60 * 1000, max: 120 });
  if (!limit.ok) {
    return rateLimitResponse(limit, "Too many token requests from this connection.", cors);
  }

  let tenantId: string;
  try {
    tenantId = await resolveTenantId(request);
    setTenantScope(tenantId);
  } catch (error) {
    console.error("Signup-token mint: tenant resolution failed", error);
    return NextResponse.json({ error: "Unknown school for this request." }, { status: 400, headers: cors });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400, headers: cors });
  }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const levelRaw = str(body?.level)?.toUpperCase() ?? null;
  const level = levelRaw && (OFFERED_LEVELS as readonly string[]).includes(levelRaw) ? levelRaw : null;
  const slotRaw = str(body?.sessionSlot)?.toLowerCase() ?? null;
  const sessionSlot = slotRaw && (TIME_SLOTS as readonly string[]).includes(slotRaw) ? slotRaw : null;
  const studentType = str(body?.studentType)?.toLowerCase() === "new" ? "new" : "returning";

  const ttlDays = Math.max(1, Math.min(90, Number(process.env.SIGNUP_TOKEN_TTL_DAYS) || 14));
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await prisma.signupToken.create({
    data: {
      token,
      email,
      name: str(body?.name),
      phone: str(body?.phone),
      branchId: str(body?.branchId),
      sessionSlot,
      level,
      studentType,
      source: "wordpress",
      expiresAt,
      tenantId,
    },
  });

  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = `${base.replace(/\/$/, "")}/auth/signup?token=${token}`;

  return NextResponse.json({ token, url, expiresAt: expiresAt.toISOString() }, { status: 201, headers: cors });
}
