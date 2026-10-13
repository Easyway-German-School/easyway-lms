import { NextRequest, NextResponse } from 'next/server';
import { requireAuthSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveLecturerId } from '@/lib/lecturer';
import { dayKey, normalizeSlot, wasAutoAddedFromLiveStart } from '@/lib/class-sessions';
import {
  belongsToLecturer,
  readAssignment,
  studentWhereForLecturer,
} from '@/lib/lecturer-assignment';
import { KIND, notifyInBackground } from '@/lib/notify';
import { classesHaveBegun, explicitStatus } from '@/lib/attendance-guard';
import { readIntakeStartDayOverrides } from '@/lib/intake-server';
import { attributeTutorAction, tutorPhrase } from '@/lib/tutor-attribution';
import { batchOfAdmission } from '@/lib/class-batch';

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

    // Keep class options for narrowing the register, even when attendance was
    // recorded without a legacy Class row.
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

    const lecturer = await prisma.lecturer.findUnique({ where: { id: lecturerId } });
    const assignment = readAssignment(lecturer);
    const where = studentWhereForLecturer(assignment, lecturerId);
    const assignedStudents = where
      ? await prisma.student.findMany({
          where: { ...(where as Record<string, unknown>), status: 'active' } as any,
          select: { id: true, tutorId: true, coTutors: { select: { lecturerId: true } }, admission: true },
        })
      : [];
    const roster = assignedStudents.filter((student) =>
      belongsToLecturer(assignment, lecturerId, student),
    );
    const records = roster.length
      ? await prisma.attendance.findMany({
          where: { studentId: { in: roster.map((student) => student.id) } },
          select: { date: true, present: true, status: true },
          orderBy: { date: 'desc' },
        })
      : [];
    const historyByDate = new Map<string, { date: string; totalStudents: number; presentStudents: number; lateStudents: number }>();
    for (const record of records) {
      const date = record.date.toISOString().slice(0, 10);
      const entry = historyByDate.get(date) ?? {
        date,
        totalStudents: 0,
        presentStudents: 0,
        lateStudents: 0,
      };
      entry.totalStudents += 1;
      if (record.present) entry.presentStudents += 1;
      if (record.status === 'late') entry.lateStudents += 1;
      historyByDate.set(date, entry);
    }

    return NextResponse.json({
      sessions,
      history: [...historyByDate.values()].slice(0, 60),
    });
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
    const where = studentWhereForLecturer(readAssignment(lecturer), lecturerId);
    if (!where) {
      return NextResponse.json(
        { error: 'You have no class assigned yet. The school office sets this.' },
        { status: 403 },
      );
    }

    const assignedStudents = await prisma.student.findMany({
      where: { ...(where as Record<string, unknown>), status: 'active' } as any,
      select: {
        id: true,
        tutorId: true,
        coTutors: { select: { lecturerId: true } },
        admission: true,
        branchId: true,
        level: true,
        sessionSlot: true,
        classesStartedAt: true,
        createdAt: true,
      },
    });
    const studentInfoById = new Map(assignedStudents.map((student) => [student.id, student]));
    const permitted = new Set(
      assignedStudents
        .filter((student) => belongsToLecturer(readAssignment(lecturer), lecturerId, student))
        .map((student) => student.id),
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
      if (new Set(rows.map((entry) => entry.studentId)).size !== rows.length) {
        return NextResponse.json(
          { error: 'That register contains duplicate students.' },
          { status: 400 },
        );
      }

      /**
       * An omitted status is a no-op for older callers. Explicit null clears a
       * previous mark; it is never converted to absent.
       */
      const startDayOverrides = await readIntakeStartDayOverrides(session.user.tenantId ?? null);
      let skippedUnmarked = 0;
      let skippedNotStarted = 0;
      const writes: Array<
        | { kind: 'clear'; studentId: string }
        | { kind: 'mark'; studentId: string; present: boolean; status: string; notes: string | null }
      > = [];
      const absences: Array<{ studentId: string; notes: string | null }> = [];

      for (const entry of rows) {
        const status = explicitStatus(entry.status);
        const clearing = entry.status === null;
        if (!status && !clearing) {
          skippedUnmarked += 1;
          continue;
        }
        const info = studentInfoById.get(entry.studentId);
        if (info && !classesHaveBegun(info, day, startDayOverrides)) {
          skippedNotStarted += 1;
          continue;
        }
        if (clearing) {
          writes.push({ kind: 'clear', studentId: entry.studentId });
          continue;
        }
        if (!status) continue;

        const present = status === 'present' || status === 'late';

        /**
       * A class started straight from the live room (see
       * `ensureClassSessionForLiveStart`) never reached a student's calendar
       * in advance — the only notice they had was the same-instant "class is
       * live" push. Marking that fact on the row itself means a dispute like
       * "I wasn't told there was class today" is answered by looking at the
       * register, not by guessing whether it's a bug.
       */
      let unscheduledNote: string | undefined;
      if (!present) {
        const info = studentInfoById.get(entry.studentId);
        if (info?.branchId && info.level && info.sessionSlot) {
          // The student's OWN batch's day (or the old shared row) — the other
          // batch's live-started class is not this student's absence.
          const studentBatch = batchOfAdmission(info.admission);
          const daySession = await prisma.classSession.findFirst({
            where: {
              branchId: info.branchId,
              level: info.level.toUpperCase(),
              date: day,
              timeSlot: normalizeSlot(info.sessionSlot),
              batch: { in: studentBatch ? [studentBatch, ""] : [""] },
            },
            orderBy: { batch: "desc" },
            select: { notes: true },
          });
          if (wasAutoAddedFromLiveStart(daySession?.notes)) {
            unscheduledNote =
              'Marked absent for a class started directly from the live room — it was never on the calendar in advance.';
          }
        }
      }

      writes.push({
        kind: 'mark',
        studentId: entry.studentId,
        present,
        status,
        notes: unscheduledNote ?? null,
      });
      if (!present) absences.push({ studentId: entry.studentId, notes: unscheduledNote ?? null });
    }

    let saved = 0;
    let cleared = 0;
    await prisma.$transaction(async (tx) => {
      for (const write of writes) {
        if (write.kind === 'clear') {
          const result = await tx.attendance.deleteMany({
            where: { studentId: write.studentId, date: day },
          });
          cleared += result.count;
          continue;
        }

        await tx.attendance.upsert({
          where: { studentId_date: { studentId: write.studentId, date: day } },
          update: {
            present: write.present,
            status: write.status,
            classId: cls?.id ?? undefined,
            notes: write.notes,
          },
          create: {
            studentId: write.studentId,
            date: day,
            present: write.present,
            status: write.status,
            classId: cls?.id ?? null,
            notes: write.notes,
          },
        });
        saved += 1;
      }
    });

    /**
     * Notify only after the register transaction commits, so a failed save
     * cannot announce a mark that was rolled back.
     */
    for (const absence of absences) {
      const tutorWho = tutorPhrase(await attributeTutorAction(absence.studentId, lecturerId));
      const studentMessage = absence.notes
        ? `${tutorWho} recorded you as absent for today's class. That class was started directly from the live room and wasn't on your calendar in advance — if you weren't told about it in time, let them know so they can review it.`
        : `${tutorWho} recorded you as absent for today's class. If that's wrong, let them know.`;
      notifyInBackground({
        to: { studentIds: [absence.studentId] },
        kind: KIND.attendanceMarked,
        severity: "info",
        title: "Marked absent today",
        message: studentMessage,
        link: "/attendance",
        dedupeKey: `attendance-marked:${absence.studentId}:${day.toISOString()}:absent`,
      });
      notifyInBackground({
        to: { parentsOfStudentIds: [absence.studentId] },
        kind: KIND.attendanceMarked,
        severity: "info",
        title: "Marked absent today",
        message: "Your child's tutor recorded them as absent for today's class.",
        link: "/parent/attendance",
        dedupeKey: `attendance-marked:${absence.studentId}:${day.toISOString()}:absent:parent`,
      });
    }

    return NextResponse.json({ count: saved, cleared, skippedUnmarked, skippedNotStarted });
  } catch (error) {
    console.error('Attendance POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
