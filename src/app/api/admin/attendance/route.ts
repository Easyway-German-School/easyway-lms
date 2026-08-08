import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { adminHasCapability } from "@/lib/admin-roles";
import { requireTenantSession, tenantScopeForAttendance } from "@/lib/tenant-access";

async function isAdmin(userId: string) {
  // Admin AND cleared for this area — see src/lib/admin-roles.ts.
  return adminHasCapability(userId, "attendance");
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTenantSession();
    if (!auth.ok) return auth.response!;

    if (!await isAdmin(auth.session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const studentId = searchParams.get("studentId");

    const where: any = tenantScopeForAttendance(auth.tenantId);
    if (studentId) where.studentId = studentId;

    const attendances = await prisma.attendance.findMany({
      where,
      include: {
        student: {
          include: {
            user: true,
            branch: true,
          },
        },
      },
      orderBy: { date: "desc" },
    });

    return NextResponse.json(attendances);
  } catch (error) {
    console.error("Error fetching attendances:", error);
    return NextResponse.json(
      { error: "Failed to fetch attendances" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTenantSession();
    if (!auth.ok) return auth.response!;

    if (!await isAdmin(auth.session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { studentId, date, status, notes } = await req.json();

    if (!studentId || !date) {
      return NextResponse.json(
        { error: "studentId and date are required" },
        { status: 400 }
      );
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, user: { select: { tenantId: true } } },
    });

    if (!student) {
      return NextResponse.json(
        { error: "Student not found" },
        { status: 404 }
      );
    }

    if (auth.tenantId && student.user.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const attendance = await prisma.attendance.create({
      data: {
        studentId,
        date: new Date(date),
        status: status || "present",
        notes,
      },
      include: {
        student: {
          include: {
            user: true,
            branch: true,
          },
        },
      },
    });

    return NextResponse.json(attendance);
  } catch (error) {
    console.error("Error creating attendance:", error);
    return NextResponse.json(
      { error: "Failed to create attendance" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireTenantSession();
    if (!auth.ok) return auth.response!;

    if (!await isAdmin(auth.session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id, date, status, notes } = await req.json();

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const attendance = await prisma.attendance.findUnique({
      where: { id },
      include: { student: { include: { user: true } } },
    });
    if (!attendance) {
      return NextResponse.json({ error: "Attendance not found" }, { status: 404 });
    }
    if (auth.tenantId && attendance.student.user.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: "Attendance not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (date) updateData.date = new Date(date);
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;

    const updated = await prisma.attendance.update({
      where: { id },
      data: updateData,
      include: {
        student: {
          include: {
            user: true,
            branch: true,
          },
        },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating attendance:", error);
    return NextResponse.json(
      { error: "Failed to update attendance" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireTenantSession();
    if (!auth.ok) return auth.response!;

    if (!await isAdmin(auth.session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await req.json();

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const attendance = await prisma.attendance.findUnique({
      where: { id },
      include: { student: { include: { user: true } } },
    });
    if (!attendance) {
      return NextResponse.json({ error: "Attendance not found" }, { status: 404 });
    }
    if (auth.tenantId && attendance.student.user.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: "Attendance not found" }, { status: 404 });
    }

    await prisma.attendance.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting attendance:", error);
    return NextResponse.json(
      { error: "Failed to delete attendance" },
      { status: 500 }
    );
  }
}
