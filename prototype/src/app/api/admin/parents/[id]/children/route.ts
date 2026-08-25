import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";

/**
 * Add or remove ONE linked child on a parent account, without touching the
 * rest of the record. Split out from the main PATCH on /api/admin/parents
 * because children are now a set (ParentStudent), not the single scalar
 * that route's PATCH still carries for legacy rollback.
 */

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const { id: parentId } = await params;
  const body = await request.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  if (!studentId) {
    return NextResponse.json({ error: "Student ID is required" }, { status: 400 });
  }

  const parent = await prisma.parent.findUnique({ where: { id: parentId }, select: { id: true } });
  if (!parent) {
    return NextResponse.json({ error: "Parent not found" }, { status: 404 });
  }

  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  try {
    await prisma.parentStudent.create({
      data: {
        parentId,
        studentId,
        linkedBy: gate.session.user.id,
        tenantId: gate.session.user.tenantId,
      },
    });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Already linked" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Unable to link child", detail: error instanceof Error ? error.message : "Unknown" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const { id: parentId } = await params;
  const body = await request.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  if (!studentId) {
    return NextResponse.json({ error: "Student ID is required" }, { status: 400 });
  }

  await prisma.parentStudent.deleteMany({ where: { parentId, studentId } });
  return NextResponse.json({ success: true });
}
