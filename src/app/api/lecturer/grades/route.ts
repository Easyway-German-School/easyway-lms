import { NextRequest, NextResponse } from 'next/server';
import { requireAuthSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveLecturerId } from '@/lib/lecturer';

function calculateGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuthSession();

    if (!session || session.user.role !== 'lecturer') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const lecturerId = await resolveLecturerId(session.user.id);
    if (!lecturerId) {
      return NextResponse.json({ error: 'Lecturer profile not found' }, { status: 404 });
    }

    // Get lecturer's exams
    const exams = await prisma.exam.findMany({
      where: { lecturerId },
      include: {
        course: true,
        _count: {
          select: {
            registrations: true,
          },
        },
      },
    });

    const sessions = await Promise.all(
      exams.map(async (exam) => {
        const gradedCount = await prisma.grade.count({
          where: { examId: exam.id },
        });

        return {
          id: exam.id,
          examId: exam.id,
          examName: exam.name,
          courseId: exam.courseId,
          courseName: exam.course?.title ?? exam.examBody ?? "Exam centre",
          totalStudents: exam._count.registrations,
          gradedStudents: gradedCount,
        };
      })
    );

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Grades GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuthSession();

    if (!session || session.user.role !== 'lecturer') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const lecturerId = await resolveLecturerId(session.user.id);
    if (!lecturerId) {
      return NextResponse.json({ error: 'Lecturer profile not found' }, { status: 404 });
    }

    const body = await req.json();
    const { studentId, examId, score, feedback, submissionMode } = body;

    if (!studentId || !examId || score === undefined) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const mode = submissionMode === 'physical' ? 'physical' : 'platform';

    if (score < 0 || score > 100) {
      return NextResponse.json({ error: 'Score must be between 0 and 100' }, { status: 400 });
    }

    // Verify exam belongs to this lecturer
    const exam = await prisma.exam.findFirst({
      where: {
        id: examId,
        lecturerId,
      },
    });

    if (!exam) {
      return NextResponse.json({ error: 'Exam not found' }, { status: 404 });
    }

    // Update or create grade
    const grade = await prisma.grade.upsert({
      where: {
        studentId_examId: { studentId, examId },
      },
      create: {
        studentId,
        examId,
        type: 'exam',
        score,
        grade: calculateGrade(score),
        // A bare number tells a student nothing about what to fix next.
        feedback: typeof feedback === 'string' ? feedback.trim() || null : null,
        submissionMode: mode,
      },
      update: {
        score,
        grade: calculateGrade(score),
        // undefined leaves existing feedback alone when only the score changes.
        feedback: typeof feedback === 'string' ? feedback.trim() || null : undefined,
        submissionMode: mode,
      },
    });

    return NextResponse.json({
      score: grade.score,
      grade: grade.grade,
      feedback: grade.feedback,
      submissionMode: grade.submissionMode,
    });
  } catch (error) {
    console.error('Grades POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
