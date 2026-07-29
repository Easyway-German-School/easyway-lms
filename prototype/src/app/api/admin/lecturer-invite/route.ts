import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLecturerInviteCode, setLecturerInviteCode, clearLecturerInviteCode } from "@/lib/lecturer-invite";
import { adminHasCapability } from "@/lib/admin-roles";

async function isAdmin(userId: string) {
  // Admin AND cleared for this area — see src/lib/admin-roles.ts.
  return adminHasCapability(userId, "staff");
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const code = await getLecturerInviteCode();
  return NextResponse.json({ code });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { code } = await request.json();
  if (typeof code !== "string") {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  await setLecturerInviteCode(code);
  return NextResponse.json({ success: true, code });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  await clearLecturerInviteCode();
  return NextResponse.json({ success: true, code: "" });
}
