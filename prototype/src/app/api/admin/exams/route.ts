import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role?.toLowerCase() === "admin";
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdmin(session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const studentId = url.searchParams.get("studentId");

  const exams = await prisma.examRegistration.findMany({
    where: studentId ? { studentId } : undefined,
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
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdmin(session.user.id)) {
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
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
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
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdmin(session.user.id)) {
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
    const exam = await prisma.examRegistration.update({
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

    return NextResponse.json({ exam });
  } catch (error) {
    return NextResponse.json({ error: "Unable to update exam registration", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
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
  const examId = typeof body.examId === "string" ? body.examId : "";
  if (!examId) {
    return NextResponse.json({ error: "Exam ID is required" }, { status: 400 });
  }

  try {
    await prisma.examRegistration.delete({ where: { id: examId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to delete exam registration", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
