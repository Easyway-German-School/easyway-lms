import { getServerSession, type Session } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const DEFAULT_EXAM_CAPACITY = 30;

export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      include: {
        examRegistrations: {
          orderBy: { createdAt: "desc" },
          include: { exam: { include: { course: true } } },
        },
      },
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const registrations = student.examRegistrations.map((r) => ({
      id: r.id,
      examId: r.examId,
      examName: r.examName,
      examDate: r.examDate.toISOString(),
      level: r.exam?.course?.level ?? (r.examName.includes("B2") ? "B2" : r.examName.includes("B1") ? "B1" : "A2"),
      status: r.status,
      registeredAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ registrations });
  } catch (error) {
    console.error("Error fetching exam registrations:", error);
    return NextResponse.json(
      { error: "Failed to fetch registrations" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const examId = typeof body.examId === "string" ? body.examId.trim() : "";

    if (!examId) {
      return NextResponse.json({ error: "Exam ID is required" }, { status: 400 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        registrations: true,
      },
    });

    if (!exam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    const existingRegistration = await prisma.examRegistration.findFirst({
      where: { studentId: student.id, examId: exam.id },
    });

    if (existingRegistration) {
      return NextResponse.json({ error: "You are already registered for this exam." }, { status: 409 });
    }

    const registeredCount = exam.registrations?.length ?? 0;
    if (registeredCount >= DEFAULT_EXAM_CAPACITY) {
      return NextResponse.json({ error: "Exam is full." }, { status: 409 });
    }

    const registration = await prisma.examRegistration.create({
      data: {
        studentId: student.id,
        examId: exam.id,
        examName: exam.name,
        examDate: exam.examDate,
        status: "registered",
      },
      include: {
        exam: true,
      },
    });

    return NextResponse.json({ registration }, { status: 201 });
  } catch (error) {
    console.error("Error registering for exam:", error);
    return NextResponse.json(
      { error: "Failed to register for exam" },
      { status: 500 }
    );
  }
}
