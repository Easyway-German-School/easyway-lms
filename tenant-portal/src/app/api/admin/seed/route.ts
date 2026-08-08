import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { createSessionToken } from "../../../../lib/auth";

export async function POST() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo-tenant" },
    update: {
      name: "Demo Tenant",
      status: "active",
      domain: "demo.easyway.local",
      brandName: "EasyWay Demo",
      emailFrom: "no-reply@easyway.local",
      emailReplyTo: "support@easyway.local",
    },
    create: {
      name: "Demo Tenant",
      slug: "demo-tenant",
      status: "active",
      domain: "demo.easyway.local",
      brandName: "EasyWay Demo",
      emailFrom: "no-reply@easyway.local",
      emailReplyTo: "support@easyway.local",
    },
  });

  // create a demo API key and store only its HMAC hash
  const demoKey = "demo-api-key-123";
  const pepper = process.env.API_KEY_PEPPER ?? "change-me";
  const demoHash = require("crypto").createHmac("sha256", pepper).update(demoKey).digest("hex");

  const partnerConfig = await prisma.partnerConfig.upsert({
    where: { tenantId: tenant.id },
    update: {
      apiKeyHash: demoHash,
      plan: "trial",
      metadata: JSON.stringify({ welcome: "demo" }),
    },
    create: {
      tenantId: tenant.id,
      apiKeyHash: demoHash,
      plan: "trial",
      metadata: JSON.stringify({ welcome: "demo" }),
    },
  });

  const passwordHash = await import("bcryptjs").then((mod) => mod.hash("DemoPass123!", 10));
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@demo.local" },
    update: {
      name: "Demo Admin",
      password: passwordHash,
      role: "ADMIN",
      tenantId: tenant.id,
    },
    create: {
      email: "admin@demo.local",
      name: "Demo Admin",
      password: passwordHash,
      role: "ADMIN",
      tenantId: tenant.id,
    },
  });

  const token = await createSessionToken(adminUser.id);

  return NextResponse.json({ tenant, partnerConfig, adminUser: { id: adminUser.id, email: adminUser.email, role: adminUser.role }, token, apiKey: demoKey });
}
