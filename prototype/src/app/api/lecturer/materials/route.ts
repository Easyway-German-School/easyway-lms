import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveLecturerId } from '@/lib/lecturer';
import { KIND, notify } from '@/lib/notify';
import { isAssigned, matchesBatch, readAssignment, studentWhereForAssignment } from '@/lib/lecturer-assignment';
import { deriveMaterialKind } from '@/lib/video-library';

function serialise(material: {
  id: string;
  title: string;
  description: string | null;
  courseId: string | null;
  course: { title: string } | null;
  filePath: string;
  fileName: string;
  fileSize: number;
  kind: string;
  level: string | null;
  series: string | null;
  episodeNumber: number | null;
  durationSeconds: number | null;
  recordedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: material.id,
    title: material.title,
    description: material.description,
    courseId: material.courseId,
    // Nullable since class recordings, which belong to a level rather than a
    // course, became uploadable.
    courseName: material.course?.title ?? null,
    filePath: material.filePath,
    fileName: material.fileName,
    fileSize: material.fileSize,
    kind: material.kind,
    level: material.level,
    series: material.series,
    episodeNumber: material.episodeNumber,
    durationSeconds: material.durationSeconds,
    recordedAt: material.recordedAt,
    uploadedAt: material.createdAt,
  };
}

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

    const materials = await prisma.material.findMany({
      where: { lecturerId },
      include: { course: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(materials.map(serialise));
  } catch (error) {
    console.error('Materials GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'lecturer') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const lecturerId = await resolveLecturerId(session.user.id);
    if (!lecturerId) {
      return NextResponse.json({ error: 'Lecturer profile not found' }, { status: 404 });
    }

    /**
     * The file arrived in the bucket before this request did.
     *
     * The browser uploads it directly (see lib/upload.ts) and posts only the
     * metadata here, so a 300 MB recording never passes through a serverless
     * function that would cap it at 4.5 MB and time out well before that.
     */
    const body = await req.json().catch(() => ({}));
    const title = String(body.title ?? '').trim();
    const description = String(body.description ?? '').trim();
    const courseId = String(body.courseId ?? '').trim();

    const fileUrl = String(body.fileUrl ?? '').trim();
    const fileName = String(body.fileName ?? '').trim();
    const fileType = String(body.fileType ?? '').trim() || 'application/octet-stream';
    const fileSize = Number(body.fileSize) || 0;

    // Video-library metadata. All optional — a plain document upload sends none
    // of it and behaves exactly as it did before.
    const level = String(body.level ?? '').trim().toUpperCase();
    const series = String(body.series ?? '').trim();
    const episodeRaw = String(body.episodeNumber ?? '').trim();
    const recordedAtRaw = String(body.recordedAt ?? '').trim();
    const durationRaw = String(body.durationSeconds ?? '').trim();
    const isRecording = String(body.isRecording ?? '') === 'true';

    if (!title || !fileUrl || !fileName) {
      return NextResponse.json({ error: 'A title and a file are required' }, { status: 400 });
    }

    // A recording belongs to a level, not a course. Everything else still
    // needs a course so it lands somewhere students can find it.
    const kind = isRecording ? 'recording' : deriveMaterialKind(fileType);
    if (kind !== 'recording' && !courseId) {
      return NextResponse.json({ error: 'Please choose a course for this material' }, { status: 400 });
    }
    if (kind === 'recording' && !level) {
      return NextResponse.json({ error: 'Please choose the level this recording is for' }, { status: 400 });
    }

    if (courseId) {
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }
    }

    const material = await prisma.material.create({
      data: {
        title,
        description: description || null,
        courseId: courseId || null,
        lecturerId,
        fileName,
        filePath: fileUrl,
        fileType,
        fileSize,
        kind,
        level: level || null,
        series: series || null,
        episodeNumber: episodeRaw ? Number(episodeRaw) || null : null,
        durationSeconds: durationRaw ? Number(durationRaw) || null : null,
        recordedAt: recordedAtRaw ? new Date(recordedAtRaw) : kind === 'recording' ? new Date() : null,
      },
      include: { course: { select: { title: true } } },
    });

    /**
     * Tell the class it is there.
     *
     * A material nobody knows about is a material nobody opens. This reaches
     * exactly the students the office assigned this tutor — same clause as
     * their roster — so an upload for Lagos A1 does not buzz Abuja, and
     * `push: true` puts it on their phone, which for most of these students is
     * the only device they use.
     */
    const lecturer = await prisma.lecturer.findUnique({ where: { id: lecturerId } });
    const assignment = readAssignment(lecturer);
    if (isAssigned(assignment)) {
      const recipients = await prisma.student.findMany({
        where: (studentWhereForAssignment(assignment) ?? {}) as any,
        select: { id: true, admission: true },
      });
      const studentIds = recipients
        .filter((student) => matchesBatch(assignment, student.admission))
        .map((student) => student.id);

      if (studentIds.length) {
        await notify({
          to: { studentIds },
          kind: KIND.materialPublished,
          severity: "info",
          title: kind === "recording" ? "A class recording is up" : "New material from your tutor",
          message:
            kind === "recording"
              ? `“${title}” is in your video library. If you missed the class, it starts where you left off.`
              : `Your tutor uploaded “${title}”. Open Materials to download it.`,
          link: kind === "recording" ? "/materials?tab=watch" : "/materials",
          push: true,
          // One announcement per material, so a tutor who saves twice does not
          // buzz two hundred phones twice.
          dedupeKey: `material:${material.id}`,
        }).catch((error) => console.error("Material notification failed", error));
      }
    }

    return NextResponse.json(serialise(material));
  } catch (error) {
    console.error('Materials POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
