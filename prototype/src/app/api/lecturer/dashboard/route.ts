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

    // Fetch lecturer's data
    const lecturer = await prisma.lecturer.findUnique({
      where: { id: session.user.id },
      include: {
        _count: {
          select: {
            classes: true,
            materials: true,
          },
        },
      },
    });

    if (!lecturer) {
      return NextResponse.json({ error: 'Lecturer not found' }, { status: 404 });
    }

    // Calculate total students across all classes
    const enrollments = await prisma.enrollment.groupBy({
      by: ['classId'],
      where: {
        class: {
          lecturerId: session.user.id,
        },
      },
      _count: {
        studentId: true,
      },
    });

    const totalStudents = enrollments.reduce((sum, e) => sum + e._count.studentId, 0);

    // Calculate average attendance
    let averageAttendance = 0;
    const attendanceRecords = await prisma.attendance.findMany({
      where: {
        class: {
          lecturerId: session.user.id,
        },
      },
      select: { present: true },
    });

    if (attendanceRecords.length > 0) {
      const presentCount = attendanceRecords.filter((a) => a.present).length;
      averageAttendance = Math.round((presentCount / attendanceRecords.length) * 100);
    }

    return NextResponse.json({
      totalClasses: lecturer._count.classes,
      totalStudents,
      totalMaterials: lecturer._count.materials,
      averageAttendance,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
