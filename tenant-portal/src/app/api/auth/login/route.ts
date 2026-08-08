import { NextResponse } from "next/server";
import bcryptjs from "bcryptjs";
import { prisma } from "../../../../lib/prisma";
import { createSessionToken } from "../../../../lib/auth";

export async function POST(req: Request) {
  const body = await req.json();
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcryptjs.compare(password, user.password))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createSessionToken(user.id);
  return NextResponse.json({ token });
}
