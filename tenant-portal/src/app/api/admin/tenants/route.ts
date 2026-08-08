import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireSession } from "../../../../lib/auth";

function getBearerToken(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  return authorization.replace("Bearer ", "").trim();
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  const session = await requireSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tenants });
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  const session = await requireSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const domain = typeof body?.domain === "string" ? body.domain.trim() : null;
  const brandName = typeof body?.brandName === "string" ? body.brandName.trim() : null;
  const emailFrom = typeof body?.emailFrom === "string" ? body.emailFrom.trim() : null;
  const emailReplyTo = typeof body?.emailReplyTo === "string" ? body.emailReplyTo.trim() : null;

  if (!name || !slug) {
    return NextResponse.json({ error: "Tenant name and slug are required" }, { status: 400 });
  }

  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: "Tenant slug already exists" }, { status: 409 });
  }

  const tenant = await prisma.tenant.create({
    data: {
      name,
      slug,
      domain,
      brandName,
      emailFrom,
      emailReplyTo,
    },
  });

  return NextResponse.json({ tenant });
}
