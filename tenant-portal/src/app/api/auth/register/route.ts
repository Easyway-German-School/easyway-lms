import { NextResponse } from "next/server";
import bcryptjs from "bcryptjs";
import { prisma } from "../../../../lib/prisma";

export async function POST(req: Request) {
  const body = await req.json();
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const tenantSlug = typeof body?.tenantSlug === "string" ? body.tenantSlug.trim() : "";

  if (!email || !password || !name) {
    return NextResponse.json({ error: "Name, email and password are required" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  let tenantId: string | undefined;
  if (tenantSlug) {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      return NextResponse.json({ error: "Tenant slug not found" }, { status: 404 });
    }
    tenantId = tenant.id;
  }

  const hashed = await bcryptjs.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      password: hashed,
      name,
      role: "STUDENT",
      tenantId,
    },
  });

  return NextResponse.json({ ok: true });
}
