import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { adminHasCapability } from "@/lib/admin-roles";

async function isAdmin(userId: string) {
  // Admin AND cleared for this area — see src/lib/admin-roles.ts.
  return adminHasCapability(userId, "attendance");
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!await isAdmin(session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const studentId = searchParams.get("studentId");

    const where = studentId ? { studentId } : {};

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
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!await isAdmin(session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { studentId, date, status, notes } = await req.json();

    if (!studentId || !date) {
      return NextResponse.json(
        { error: "studentId and date are required" },
        { status: 400 }
      );
    }

    // Check if student exists
    const student = await prisma.student.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      return NextResponse.json(
        { error: "Student not found" },
        { status: 404 }
      );
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
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!await isAdmin(session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id, date, status, notes } = await req.json();

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const updateData: any = {};
    if (date) updateData.date = new Date(date);
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;

    const attendance = await prisma.attendance.update({
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

    return NextResponse.json(attendance);
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
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!await isAdmin(session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await req.json();

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
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
