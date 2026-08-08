import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";

async function requireExamAdmin() {
  const gate = await requireCapability("exams");
  if (!gate.ok) return gate.response;
  return { userId: gate.session.user.id as string };
}

export async function GET(request: Request) {
  const auth = await requireExamAdmin();
  if (auth instanceof NextResponse) return auth;

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
  const auth = await requireExamAdmin();
  if (auth instanceof NextResponse) return auth;

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
