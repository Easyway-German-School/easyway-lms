import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { requireSession } from "../../../../../lib/auth";
import crypto from "crypto";

function hashKey(key: string) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function getBearerToken(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  return authorization.replace("Bearer ", "").trim();
}

async function requireAdmin(token: string | null) {
  const session = await requireSession(token);
  if (!session || session.role !== "ADMIN") return null;
  return session;
}

function generateKey() {
  return crypto.randomBytes(32).toString("hex");
}

function hmacKey(key: string) {
  const pepper = process.env.API_KEY_PEPPER ?? "change-me";
  return crypto.createHmac("sha256", pepper).update(key).digest("hex");
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  const session = await requireAdmin(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  // generate unique apiKey, retry on collision (by hash)
  let apiKey = generateKey();
  let apiKeyHash = hmacKey(apiKey);
  for (let i = 0; i < 5; i++) {
    const existing = await prisma.partnerConfig.findUnique({ where: { apiKeyHash } });
    if (!existing) break;
    apiKey = generateKey();
    apiKeyHash = hmacKey(apiKey);
  }

  const partner = await prisma.partnerConfig.upsert({
    where: { tenantId },
    update: { apiKeyHash },
    create: { tenantId, apiKeyHash, plan: "trial", metadata: JSON.stringify({ createdBy: session.userId }) },
  });

  // return the plaintext apiKey once to the caller; do not persist it.
  return NextResponse.json({ apiKey, config: { plan: partner.plan, metadata: partner.metadata } });
}
