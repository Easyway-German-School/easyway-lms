import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import crypto from "crypto";
import { isRateLimited, recordLog } from "../../../../lib/rateLimiter";

// Rate limit settings
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_KNOWN = 60; // per key
const RATE_LIMIT_MAX_UNKNOWN = 20; // per IP when key unknown
export async function GET(req: Request) {
  function getApiKey(r: Request) {
    const authorization = r.headers.get("authorization");
    if (authorization && authorization.startsWith("Bearer ")) {
      return authorization.replace("Bearer ", "").trim();
    }
    try {
      const url = new URL(r.url);
      return url.searchParams.get("apiKey");
    } catch (e) {
      return null;
    }
  }

  const apiKey = getApiKey(req);
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";

  if (!apiKey) {
    // rate limit by IP for anonymous callers
    if (await isRateLimited(`ip:${ip}`, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_UNKNOWN)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
    recordLog(`${new Date().toISOString()} INVALID_ATTEMPT ip:${ip} missing_api_key`);
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  const apiKeyHash = crypto.createHmac("sha256", process.env.API_KEY_PEPPER ?? "change-me").update(apiKey).digest("hex");

  // rate limit by key
  if (await isRateLimited(`key:${apiKeyHash}`, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_KNOWN)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const config = await prisma.partnerConfig.findUnique({ where: { apiKeyHash } });
  if (!config) {
    recordLog(`${new Date().toISOString()} INVALID_ATTEMPT key:${apiKeyHash} invalid_key ip=${ip}`);
    return NextResponse.json({ error: "Invalid API key" }, { status: 403 });
  }

  // record success
  recordLog(`${new Date().toISOString()} INVALID_ATTEMPT key:${apiKeyHash} success`);

  const tenant = await prisma.tenant.findUnique({ where: { id: config.tenantId } });

  return NextResponse.json({
    tenant: tenant ? { id: tenant.id, slug: tenant.slug, domain: tenant.domain, brandName: tenant.brandName } : null,
    config: { plan: config.plan ?? null, metadata: config.metadata ? JSON.parse(config.metadata) : null },
  });
}
