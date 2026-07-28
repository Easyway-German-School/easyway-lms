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

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const registrations = await prisma.examRegistration.findMany({
    include: {
      student: {
        include: {
          user: true,
          branch: true,
        },
      },
    },
    orderBy: { examDate: "asc" },
  });

  return NextResponse.json({ registrations });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  const examName = typeof body.examName === "string" ? body.examName.trim() : "";
  const examDate = typeof body.examDate === "string" ? new Date(body.examDate) : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() : null;

  if (!studentId || !examName || !examDate || Number.isNaN(examDate.getTime())) {
    return NextResponse.json({ error: "Student, exam name, and valid exam date are required" }, { status: 400 });
  }

  try {
    const registration = await prisma.examRegistration.create({
      data: {
        studentId,
        examName,
        examDate,
        notes,
      },
    });

    return NextResponse.json({ registration }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Unable to create exam registration", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
