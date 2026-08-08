import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { adminHasCapability } from "@/lib/admin-roles";
import { requireTenantSession, tenantScopeForExamRegistration } from "@/lib/tenant-access";

async function isAdmin(userId: string) {
  // Admin AND cleared for this area — see src/lib/admin-roles.ts.
  return adminHasCapability(userId, "exams");
}

export async function GET(request: Request) {
  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const studentId = url.searchParams.get("studentId");

  const where: any = tenantScopeForExamRegistration(auth.tenantId);
  if (studentId) where.studentId = studentId;

  const exams = await prisma.examRegistration.findMany({
    where,
    include: {
      student: {
        include: {
          user: true,
          branch: true,
        },
      },
    },
    orderBy: { examDate: "desc" },
  });

  return NextResponse.json({ exams });
}

export async function POST(request: Request) {
  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  const examName = typeof body.examName === "string" ? body.examName.trim() : "";
  const examDate = typeof body.examDate === "string" ? body.examDate : "";
  const status = typeof body.status === "string" ? body.status : "registered";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!studentId || !examName || !examDate) {
    return NextResponse.json({ error: "Student ID, exam name, and date are required" }, { status: 400 });
  }

  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, user: { select: { tenantId: true } } },
    });
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    if (auth.tenantId && student.user.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const exam = await prisma.examRegistration.create({
      data: {
        studentId,
        examName,
        examDate: new Date(examDate),
        status,
        notes: notes || null,
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

    return NextResponse.json({ exam }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Unable to register exam", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const examId = typeof body.examId === "string" ? body.examId : "";
  const examName = typeof body.examName === "string" ? body.examName.trim() : undefined;
  const examDate = typeof body.examDate === "string" ? body.examDate : undefined;
  const status = typeof body.status === "string" ? body.status : undefined;
  const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;

  if (!examId) {
    return NextResponse.json({ error: "Exam ID is required" }, { status: 400 });
  }

  try {
    const exam = await prisma.examRegistration.findUnique({
      where: { id: examId },
      include: { student: { include: { user: true } } },
    });
    if (!exam) {
      return NextResponse.json({ error: "Exam registration not found" }, { status: 404 });
    }
    if (auth.tenantId && exam.student.user.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: "Exam registration not found" }, { status: 404 });
    }

    const updated = await prisma.examRegistration.update({
      where: { id: examId },
      data: {
        ...(examName !== undefined ? { examName } : {}),
        ...(examDate !== undefined ? { examDate: new Date(examDate) } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(notes !== undefined ? { notes: notes || null } : {}),
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

    return NextResponse.json({ exam: updated });
  } catch (error) {
    return NextResponse.json({ error: "Unable to update exam registration", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const examId = typeof body.examId === "string" ? body.examId : "";
  if (!examId) {
    return NextResponse.json({ error: "Exam ID is required" }, { status: 400 });
  }

  try {
    const exam = await prisma.examRegistration.findUnique({
      where: { id: examId },
      include: { student: { include: { user: true } } },
    });
    if (!exam) {
      return NextResponse.json({ error: "Exam registration not found" }, { status: 404 });
    }
    if (auth.tenantId && exam.student.user.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: "Exam registration not found" }, { status: 404 });
    }

    await prisma.examRegistration.delete({ where: { id: examId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to delete exam registration", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
