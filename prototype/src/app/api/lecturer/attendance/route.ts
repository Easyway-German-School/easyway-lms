import { NextRequest, NextResponse } from 'next/server';
import { requireAuthSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveLecturerId } from '@/lib/lecturer';
import { dayKey } from '@/lib/class-sessions';
import { readAssignment, studentWhereForAssignment } from '@/lib/lecturer-assignment';

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

    // Get lecturer's classes with attendance sessions
    const classes = await prisma.class.findMany({
      where: { lecturerId },
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
    const session = await requireAuthSession();

    if (!session || String(session.user?.role ?? '').toLowerCase() !== 'lecturer') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const lecturerId = await resolveLecturerId(session.user.id);
    if (!lecturerId) {
      return NextResponse.json({ error: 'Lecturer profile not found' }, { status: 404 });
    }

    const body = await req.json();
    const { courseId, date, attendance } = body;

    if (!date || !Array.isArray(attendance)) {
      return NextResponse.json({ error: 'A date and a register are required' }, { status: 400 });
    }

    const day = dayKey(date);

    /**
     * The class is now optional context, not the key.
     *
     * Attendance is unique on (studentId, date) — one mark per student per day.
     * The old code deleted by (classId, date) and then created fresh rows,
     * which collided the moment a student had been marked from anywhere else
     * that day, and failed the whole save. Upserting on the real key is both
     * correct and idempotent, so a tutor can correct a register by saving it
     * again.
     */
    const cls = courseId
      ? await prisma.class.findFirst({ where: { courseId, lecturerId }, select: { id: true } })
      : null;

    /**
     * A tutor may only mark their own students. Without this check the student
     * ids come straight off the request body, and any tutor could write
     * attendance for the whole school.
     */
    const lecturer = await prisma.lecturer.findUnique({ where: { id: lecturerId } });
    const where = studentWhereForAssignment(readAssignment(lecturer));
    if (!where) {
      return NextResponse.json(
        { error: 'You have no class assigned yet. The school office sets this.' },
        { status: 403 },
      );
    }

    const permitted = new Set(
      (
        await prisma.student.findMany({
          where: where as any,
          select: { id: true },
        })
      ).map((student) => student.id),
    );

      const rows = attendance.filter((entry) =>
      typeof entry?.studentId === 'string' && permitted.has(entry.studentId),
    );

    if (rows.length !== attendance.length) {
      return NextResponse.json(
        { error: 'That register contains students who are not in your class.' },
        { status: 403 },
      );
    }

    let saved = 0;
    for (const entry of rows) {
      const present = Boolean(entry.present);
      await prisma.attendance.upsert({
        where: { studentId_date: { studentId: entry.studentId, date: day } },
        update: { present, status: present ? 'present' : 'absent', classId: cls?.id ?? undefined },
        create: {
          studentId: entry.studentId,
          date: day,
          present,
          status: present ? 'present' : 'absent',
          classId: cls?.id ?? null,
        },
      });
      saved += 1;
    }

    return NextResponse.json({ count: saved });
  } catch (error) {
    console.error('Attendance POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
