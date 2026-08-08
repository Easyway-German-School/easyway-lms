import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { requireSession } from "../../../../../lib/auth";

function getBearerToken(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  return authorization.replace("Bearer ", "").trim();
}

async function requireAdmin(token: string | null) {
  const session = await requireSession(token);
  if (!session || session.role !== "ADMIN") {
    return null;
  }
  return session;
}

export async function GET(req: Request, { params }: { params: { tenantId: string } }) {
  const token = getBearerToken(req);
  const session = await requireAdmin(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: params.tenantId },
  });

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  return NextResponse.json({ tenant });
}

export async function PUT(req: Request, { params }: { params: { tenantId: string } }) {
  const token = getBearerToken(req);
  const session = await requireAdmin(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : undefined;
  const domain = typeof body?.domain === "string" ? body.domain.trim() : undefined;
  const brandName = typeof body?.brandName === "string" ? body.brandName.trim() : undefined;
  const emailFrom = typeof body?.emailFrom === "string" ? body.emailFrom.trim() : undefined;
  const emailReplyTo = typeof body?.emailReplyTo === "string" ? body.emailReplyTo.trim() : undefined;
  const status = typeof body?.status === "string" ? body.status.trim() : undefined;

  if (!name && !slug && !domain && !brandName && !emailFrom && !emailReplyTo && !status) {
    return NextResponse.json({ error: "No tenant updates provided" }, { status: 400 });
  }

  if (slug) {
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (existing && existing.id !== params.tenantId) {
      return NextResponse.json({ error: "Tenant slug already in use" }, { status: 409 });
    }
  }

  const tenant = await prisma.tenant.update({
    where: { id: params.tenantId },
    data: {
      name: name ?? undefined,
      slug: slug ?? undefined,
      domain: domain ?? undefined,
      brandName: brandName ?? undefined,
      emailFrom: emailFrom ?? undefined,
      emailReplyTo: emailReplyTo ?? undefined,
      status: status ?? undefined,
    },
  });

  return NextResponse.json({ tenant });
}
