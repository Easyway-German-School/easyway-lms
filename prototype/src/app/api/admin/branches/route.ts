import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { tenantWhere } from "@/lib/auth";

export async function GET() {
  const gate = await requireCapability("branches");
  if (!gate.ok) return gate.response;

  const branches = await prisma.branch.findMany({
    where: tenantWhere(gate.session.user.tenantId),
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ branches });
}

export async function POST(request: Request) {
  const gate = await requireCapability("branches");
  if (!gate.ok) return gate.response;

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
        ...(gate.session.user.tenantId ? { tenantId: gate.session.user.tenantId } : {}),
      },
    });
    return NextResponse.json({ branch }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Unable to create branch", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const gate = await requireCapability("branches");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const branchId = typeof body.branchId === "string" ? body.branchId : "";
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const location = typeof body.location === "string" ? body.location.trim() : undefined;
  const status = typeof body.status === "string" ? body.status : undefined;

  if (!branchId) {
    return NextResponse.json({ error: "Branch ID is required" }, { status: 400 });
  }

  try {
    if (gate.session.user.tenantId) {
      const existing = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { tenantId: true },
      });
      if (!existing || existing.tenantId !== gate.session.user.tenantId) {
        return NextResponse.json({ error: "Branch not found" }, { status: 404 });
      }
    }

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
  const gate = await requireCapability("branches");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const branchId = typeof body.branchId === "string" ? body.branchId : "";
  if (!branchId) {
    return NextResponse.json({ error: "Branch ID is required" }, { status: 400 });
  }

  try {
    if (gate.session.user.tenantId) {
      const existing = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { tenantId: true },
      });
      if (!existing || existing.tenantId !== gate.session.user.tenantId) {
        return NextResponse.json({ error: "Branch not found" }, { status: 404 });
      }
    }

    await prisma.branch.delete({ where: { id: branchId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to delete branch", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
