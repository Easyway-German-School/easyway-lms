import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveLecturerId } from '@/lib/lecturer';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'lecturer') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const lecturerId = await resolveLecturerId(session.user.id);
    if (!lecturerId) {
      return NextResponse.json({ error: 'Lecturer profile not found' }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const courseId = searchParams.get('courseId');
    const date = searchParams.get('date');

    if (!courseId || !date) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Get the class for this course
    const cls = await prisma.class.findFirst({
      where: {
        courseId,
        lecturerId,
      },
    });

    if (!cls) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 });
    }

    // Get enrolled students
    const enrollments = await prisma.enrollment.findMany({
      where: { classId: cls.id },
      include: { student: { include: { user: true, branch: true } } },
    });

    // Get attendance records for this date
    const attendanceRecords = await prisma.attendance.findMany({
      where: {
        classId: cls.id,
        date: new Date(date),
      },
    });

    const attendanceMap = new Map(attendanceRecords.map((a) => [a.studentId, a.present]));

    const students = enrollments.map((e) => ({
      id: e.studentId,
      name: e.student.user.name || 'Unknown',
      email: e.student.user.email,
      branch: e.student.branch?.name || 'N/A',
      present: attendanceMap.get(e.studentId) ?? false,
    }));

    return NextResponse.json(students);
  } catch (error) {
    console.error('Attendance students GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
