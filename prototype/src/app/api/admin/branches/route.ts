import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role?.toLowerCase() === "admin";
}

export async function GET() {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdmin(session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const branches = await prisma.branch.findMany({
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ branches });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdmin(session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  const status = typeof body.status === "string" ? body.status : "active";

  if (!name) {
    return NextResponse.json({ error: "Branch name is required" }, { status: 400 });
  }

  try {
    const branch = await prisma.branch.create({
      data: {
        name,
        location: location || null,
        status,
      },
    });
    return NextResponse.json({ branch }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Unable to create branch", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdmin(session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const branchId = typeof body.branchId === "string" ? body.branchId : "";
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const location = typeof body.location === "string" ? body.location.trim() : undefined;
  const status = typeof body.status === "string" ? body.status : undefined;

  if (!branchId) {
    return NextResponse.json({ error: "Branch ID is required" }, { status: 400 });
  }

  try {
    const branch = await prisma.branch.update({
      where: { id: branchId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(location !== undefined ? { location: location || null } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    });
    return NextResponse.json({ branch });
  } catch (error) {
    return NextResponse.json({ error: "Unable to update branch", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdmin(session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const branchId = typeof body.branchId === "string" ? body.branchId : "";
  if (!branchId) {
    return NextResponse.json({ error: "Branch ID is required" }, { status: 400 });
  }

  try {
    await prisma.branch.delete({ where: { id: branchId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to delete branch", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
