import { NextRequest, NextResponse } from 'next/server';
import { requireAuthSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveLecturerId } from '@/lib/lecturer';
import { KIND, notify } from '@/lib/notify';
import { belongsToLecturer, readAssignment, studentWhereForLecturer } from '@/lib/lecturer-assignment';
import { deriveMaterialKind } from '@/lib/video-library';
import { EMBED_FILE_TYPE, parseEmbed } from '@/lib/media-embed';

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
    const session = await requireAuthSession();

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
    const session = await requireAuthSession();

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

    /**
     * A LINK IS AN ALTERNATIVE TO A FILE, not an extra field on one.
     *
     * When `sourceUrl` is present nothing was uploaded, so the file fields are
     * synthesised from the parsed link instead of being required. Everything
     * downstream — the shelves, the student queries, the notification — then
     * treats it as an ordinary video row. See lib/media-embed.ts.
     */
    const sourceUrl = String(body.sourceUrl ?? '').trim();
    const embed = sourceUrl ? parseEmbed(sourceUrl) : null;
    if (sourceUrl && !embed) {
      return NextResponse.json(
        { error: 'That link is not a video we recognise. Paste a YouTube, Vimeo, Loom or Google Drive link, or a direct .mp4 URL.' },
        { status: 400 },
      );
    }

    const fileUrl = embed ? embed.sourceUrl : String(body.fileUrl ?? '').trim();
    const fileName = embed ? embed.label : String(body.fileName ?? '').trim();
    const fileType = embed ? EMBED_FILE_TYPE : String(body.fileType ?? '').trim() || 'application/octet-stream';
    // A link occupies no storage. Recording it as 0 keeps the tutor's "MB used"
    // honest rather than inventing a size for something we do not host.
    const fileSize = embed ? 0 : Number(body.fileSize) || 0;

    // Video-library metadata. All optional — a plain document upload sends none
    // of it and behaves exactly as it did before.
    const level = String(body.level ?? '').trim().toUpperCase();
    const series = String(body.series ?? '').trim();
    const episodeRaw = String(body.episodeNumber ?? '').trim();
    const recordedAtRaw = String(body.recordedAt ?? '').trim();
    const durationRaw = String(body.durationSeconds ?? '').trim();
    const isRecording = String(body.isRecording ?? '') === 'true';

    if (!title || !fileUrl || !fileName) {
      return NextResponse.json({ error: 'A title and either a file or a video link are required' }, { status: 400 });
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

    /**
     * THE LEVEL IS ALWAYS STAMPED ON THE ROW, even when it came from a course.
     *
     * Students are found by level, and the row carried one only when the tutor
     * was uploading a recording — for a document it stayed null and visibility
     * rested entirely on the join to `course.level`. One denormalised column
     * left empty meant a material's reachability depended on a course row
     * staying correct forever, and there are already forty-odd courses here
     * with near-duplicate names for a tutor to choose wrongly between.
     *
     * Copying it down at write time makes the material self-describing: it says
     * which level it is for, and the student query can match it directly.
     */
    let resolvedLevel = level || null;
    if (courseId) {
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { level: true },
      });
      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }
      resolvedLevel = resolvedLevel || (course.level ? String(course.level).toUpperCase() : null);
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
        level: resolvedLevel,
        series: series || null,
        episodeNumber: episodeRaw ? Number(episodeRaw) || null : null,
        durationSeconds: durationRaw ? Number(durationRaw) || null : null,
        recordedAt: recordedAtRaw ? new Date(recordedAtRaw) : kind === 'recording' ? new Date() : null,
        // YouTube publishes a poster at a predictable URL, so a linked video
        // gets a real thumbnail on the shelf instead of the grey placeholder
        // every other provider falls back to.
        thumbnailPath: embed?.thumbnailUrl ?? null,
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
    const audience = studentWhereForLecturer(assignment, lecturerId);
    if (audience) {
      const recipients = await prisma.student.findMany({
        where: audience as any,
        select: { id: true, admission: true, tutorId: true },
      });
      const studentIds = recipients
        .filter((student) => belongsToLecturer(assignment, lecturerId, student))
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
