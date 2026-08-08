import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string }
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const lessonId = formData.get("lessonId")?.toString();
    const submission = formData.get("submission")?.toString() || "";
    const file = formData.get("file") as File | null;

    if (!lessonId) {
      return NextResponse.json({ error: "Lesson ID required" }, { status: 400 });
    }

    let submissionText = submission;
    if (file) {
      const fileName = file.name;
      // In production, upload to S3 or similar. For now, just record the file info
      submissionText += `\n\n[File uploaded: ${fileName}]`;
    }

    // Record as a Grade with type "assignment"
    const grade = await prisma.grade.create({
      data: {
        studentId: student.id,
        type: "assignment",
        content: submissionText,
        score: 0, // Lecturer will grade later
        feedback: "Pending lecturer review"
      }
    });

    // Mark lesson as completed
    await prisma.completion.upsert({
      where: {
        studentId_lessonId: {
          studentId: student.id,
          lessonId
        }
      },
      update: {
        status: "completed",
        completedAt: new Date()
      },
      create: {
        studentId: student.id,
        lessonId,
        status: "completed",
        completedAt: new Date()
      }
    });

    return NextResponse.json({
      message: "Assignment submitted successfully",
      gradeId: grade.id
    });
  } catch (error) {
    console.error("Assignment submission error:", error);
    return NextResponse.json({ error: "Failed to submit assignment" }, { status: 500 });
  }
}
