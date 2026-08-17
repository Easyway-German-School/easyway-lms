import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { notify, KIND } from "@/lib/notify";

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    include: { tutor: { select: { userId: true } } },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  try {
    /**
     * JSON, not multipart — and that is the fix, not a refactor.
     *
     * This route used to take the file itself and then THROW THE BYTES AWAY,
     * recording `[File uploaded: homework.pdf]` in a text column and returning
     * "Assignment submitted successfully". A student handed in their work, was
     * told it arrived, and there was nothing for the tutor to open. Silent data
     * loss with a success message on top is the worst failure in the app.
     *
     * The browser now sends the file to the bucket first, through the same
     * presigned path everything else uses, and posts the resulting URL here.
     * That also gets a real homework scan off Vercel's 4.5 MB request-body
     * ceiling, which this route would have hit anyway the moment it did try to
     * store anything.
     */
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const lessonId = String(body.lessonId ?? "");
    const submission = String(body.submission ?? "");
    const fileUrl = body.fileUrl ? String(body.fileUrl) : null;
    const fileName = body.fileName ? String(body.fileName) : null;

    if (!lessonId) {
      return NextResponse.json({ error: "Lesson ID required" }, { status: 400 });
    }
    if (!submission.trim() && !fileUrl) {
      return NextResponse.json({ error: "Write something or attach a file" }, { status: 400 });
    }

    let submissionText = submission;
    if (fileUrl) {
      // A link the tutor can actually click, rather than a filename that only
      // proves a file once existed on somebody else's laptop.
      submissionText += `${submissionText ? "\n\n" : ""}[${fileName ?? "Attached file"}](${fileUrl})`;
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

    // Same rule as the modern assignment path: tell the tutor this student is
    // actually assigned to, not a guess at who teaches the lesson.
    if (student.tutor?.userId) {
      await notify({
        to: { userIds: [student.tutor.userId] },
        kind: KIND.assignmentSubmitted,
        severity: "info",
        title: "A submission needs marking",
        message: `${session.user?.name ?? "A student"} handed in work — it's pending review.`,
        link: "/lecturer/assignments/mark",
        dedupeKey: `assignment-submitted:${lessonId}:${student.id}`,
      }).catch((error) => console.error("Legacy assignment notification failed", error));
    }

    return NextResponse.json({
      message: "Assignment submitted successfully",
      gradeId: grade.id
    });
  } catch (error) {
    console.error("Assignment submission error:", error);
    return NextResponse.json({ error: "Failed to submit assignment" }, { status: 500 });
  }
}
