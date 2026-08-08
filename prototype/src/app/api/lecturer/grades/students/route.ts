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

    const { searchParams } = new URL(req.url);
    const examId = searchParams.get('examId');

    if (!examId) {
      return NextResponse.json({ error: 'Missing examId' }, { status: 400 });
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

    // Get registered students and their grades
    const registrations = await prisma.examRegistration.findMany({
      where: { examId },
      include: { student: { include: { user: true } } },
    });

    const grades = await prisma.grade.findMany({
      where: { examId },
    });

    const gradesMap = new Map(grades.map((g) => [g.studentId, g]));

    const students = registrations
      // External candidates have no Student row, so no grade can hang off them.
      .filter((reg) => reg.student !== null)
      .map((reg) => {
      const grade = gradesMap.get(reg.studentId!);
      const score = grade?.score ?? 0;
      return {
        id: grade?.id || `${reg.studentId}-${examId}`,
        studentId: reg.studentId!,
        studentName: reg.student!.user.name || 'Unknown',
        studentCode: reg.student!.studentCode,
        email: reg.student!.user.email,
        examName: exam.name,
        score,
        totalScore: 100,
        grade: calculateGrade(score),
        feedback: grade?.feedback ?? '',
        submissionMode: grade?.submissionMode ?? 'platform',
        // Distinguishes "scored zero" from "not marked yet" — both show 0.
        graded: Boolean(grade),
      };
    });

    return NextResponse.json(students);
  } catch (error) {
    console.error('Grades students GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
