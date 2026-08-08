import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireSession } from "../../../../lib/auth";

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

export async function GET(req: Request) {
  const token = getBearerToken(req);
  const session = await requireAdmin(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const branches = await prisma.branch.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ branches });
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  const session = await requireAdmin(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : null;
  const status = typeof body?.status === "string" ? body.status.trim() : "active";

  if (!name || !tenantId) {
    return NextResponse.json({ error: "Branch name and tenant ID are required" }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const branch = await prisma.branch.create({
    data: {
      name,
      tenantId,
      location,
      status,
    },
  });

  return NextResponse.json({ branch });
}
