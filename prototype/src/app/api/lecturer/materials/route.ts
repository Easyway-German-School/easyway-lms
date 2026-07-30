import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveLecturerId } from '@/lib/lecturer';
import { deriveMaterialKind } from '@/lib/video-library';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads', 'materials');

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

    const formData = await req.formData();
    const title = String(formData.get('title') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim();
    const courseId = String(formData.get('courseId') ?? '').trim();
    const file = formData.get('file') as File | null;

    // Video-library metadata. All optional — a plain document upload sends none
    // of it and behaves exactly as it did before.
    const level = String(formData.get('level') ?? '').trim().toUpperCase();
    const series = String(formData.get('series') ?? '').trim();
    const episodeRaw = String(formData.get('episodeNumber') ?? '').trim();
    const recordedAtRaw = String(formData.get('recordedAt') ?? '').trim();
    const durationRaw = String(formData.get('durationSeconds') ?? '').trim();
    const isRecording = String(formData.get('isRecording') ?? '') === 'true';

    if (!title || !file) {
      return NextResponse.json({ error: 'A title and a file are required' }, { status: 400 });
    }

    // A recording belongs to a level, not a course. Everything else still
    // needs a course so it lands somewhere students can find it.
    const kind = isRecording ? 'recording' : deriveMaterialKind(file.type);
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

    // The directory was previously assumed to exist, so the very first upload
    // on a fresh clone failed with an unhelpful ENOENT.
    mkdirSync(UPLOAD_DIR, { recursive: true });

    const buffer = await file.arrayBuffer();
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    writeFileSync(join(UPLOAD_DIR, safeName), Buffer.from(buffer));

    const material = await prisma.material.create({
      data: {
        title,
        description: description || null,
        courseId: courseId || null,
        lecturerId,
        fileName: file.name,
        filePath: `/uploads/materials/${safeName}`,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        kind,
        level: level || null,
        series: series || null,
        episodeNumber: episodeRaw ? Number(episodeRaw) || null : null,
        durationSeconds: durationRaw ? Number(durationRaw) || null : null,
        recordedAt: recordedAtRaw ? new Date(recordedAtRaw) : kind === 'recording' ? new Date() : null,
      },
      include: { course: { select: { title: true } } },
    });

    return NextResponse.json(serialise(material));
  } catch (error) {
    console.error('Materials POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
