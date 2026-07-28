import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'lecturer') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get lecturer's classes with attendance sessions
    const classes = await prisma.class.findMany({
      where: { lecturerId: session.user.id },
      include: {
        course: true,
        _count: {
          select: {
            enrollments: true,
            attendance: true,
          },
        },
      },
    });

    const sessions = await Promise.all(
      classes.map(async (cls) => {
        const presentCount = await prisma.attendance.count({
          where: {
            classId: cls.id,
            present: true,
          },
        });

        return {
          id: cls.id,
          courseId: cls.courseId,
          courseName: cls.course.title,
          date: new Date().toISOString().split('T')[0],
          totalStudents: cls._count.enrollments,
          presentStudents: presentCount,
        };
      })
    );

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Attendance GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'lecturer') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { courseId, date, attendance } = body;

    if (!courseId || !date || !Array.isArray(attendance)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // Get the class for this course
    const cls = await prisma.class.findFirst({
      where: {
        courseId,
        lecturerId: session.user.id,
      },
    });

    if (!cls) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 });
    }

    // Delete existing attendance for this date
    await prisma.attendance.deleteMany({
      where: {
        classId: cls.id,
        date: new Date(date),
      },
    });

    // Create new attendance records
    const records = await Promise.all(
      attendance.map((a) =>
        prisma.attendance.create({
          data: {
            studentId: a.studentId,
            classId: cls.id,
            date: new Date(date),
            present: a.present,
          },
        })
      )
    );

    return NextResponse.json({ count: records.length });
  } catch (error) {
    console.error('Attendance POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
