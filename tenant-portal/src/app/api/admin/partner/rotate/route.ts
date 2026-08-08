import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { requireSession } from "../../../../../lib/auth";
import crypto from "crypto";
import fs from "fs";

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
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const partner = await prisma.partnerConfig.findUnique({ where: { tenantId } });
  if (!partner) return NextResponse.json({ error: "Partner config not found" }, { status: 404 });

  // rotate key: generate new plaintext, store only hash
  const newKey = generateKey();
  const newHash = hmacKey(newKey);
  const oldHash = partner.apiKeyHash ?? null;

  await prisma.partnerConfig.update({ where: { tenantId }, data: { apiKeyHash: newHash } });

  // log rotation
  try {
    const logDir = "./tenant-portal/logs";
    fs.mkdirSync(logDir, { recursive: true });
    const logLine = `${new Date().toISOString()} ROTATE tenant=${tenantId} admin=${session.userId} oldHash=${oldHash} newHash=${newHash}\n`;
    fs.appendFileSync(`${logDir}/rotation.log`, logLine);
  } catch (e) {
    // ignore
  }

  return NextResponse.json({ apiKey: newKey });
}
