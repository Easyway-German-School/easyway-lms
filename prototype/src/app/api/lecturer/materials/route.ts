import { NextRequest, NextResponse, after } from 'next/server';
import { requireAuthSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveLecturerId } from '@/lib/lecturer';
import { KIND, notify } from '@/lib/notify';
import { groupStudentsByTutorPhrase } from '@/lib/tutor-attribution';
import {
  assignmentBatches,
  assignmentHasGroup,
  belongsToLecturer,
  isAssigned,
  parseGroupKey,
  readAssignment,
  studentWhereForLecturer,
} from '@/lib/lecturer-assignment';
import { tutorTeachingGroups } from '@/lib/tutor-classes-server';
import { batchOfAdmission, canonicalBatch } from '@/lib/class-batch';
import { deriveMaterialKind } from '@/lib/video-library';
import { AUDIO_EMBED_FILE_TYPE, EMBED_FILE_TYPE, parseAudioLink, parseEmbed } from '@/lib/media-embed';
import { generateForMaterial } from '@/lib/material-ai';
import { driveDownloadUrl, DRIVE_LINK_FILE_TYPE } from '@/lib/drive-import';

function serialise(
  material: {
    id: string;
    title: string;
    description: string | null;
    courseId: string | null;
    course: { title: string } | null;
    filePath: string;
    fileType: string;
    fileName: string;
    fileSize: number;
    kind: string;
    level: string | null;
    series: string | null;
    episodeNumber: number | null;
    durationSeconds: number | null;
    recordedAt: Date | null;
    createdAt: Date;
    aiState: string;
    lecturerId: string | null;
    uploadedBy: string | null;
    batch?: string | null;
  },
  lecturerId: string,
) {
  return {
    // Which batch this is for ("September"), or null = every batch. Shown on the
    // tutor's list so an October handout is never mistaken for a September one.
    batch: material.batch ?? null,
    id: material.id,
    aiState: material.aiState,
    title: material.title,
    description: material.description,
    courseId: material.courseId,
    // Nullable since class recordings, which belong to a level rather than a
    // course, became uploadable.
    courseName: material.course?.title ?? null,
    // See the same rewrite in /api/student/materials — a Drive "view" link
    // can fail to open in a mobile webview; the direct-download link always
    // works, and this fixes materials imported before that fix existed too.
    filePath:
      material.fileType === DRIVE_LINK_FILE_TYPE ? driveDownloadUrl(material.filePath) : material.filePath,
    fileName: material.fileName,
    fileSize: material.fileSize,
    kind: material.kind,
    level: material.level,
    series: material.series,
    episodeNumber: material.episodeNumber,
    durationSeconds: material.durationSeconds,
    recordedAt: material.recordedAt,
    uploadedAt: material.createdAt,
    // Whether THIS tutor uploaded it, vs. an office cohort upload landing on
    // their portal because it matches their assignment — the UI needs this to
    // label "From the office" and to decide when "Send to my class" applies.
    mine: material.lecturerId === lecturerId,
    fromOffice: !material.lecturerId && Boolean(material.uploadedBy),
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

    /**
     * Two ways a material reaches this tutor:
     *   1. They uploaded it (`lecturerId` is theirs), or the office aimed it at
     *      them by name (same column).
     *   2. The office aimed it at a cohort — a level, and optionally one
     *      branch / sitting — that this tutor's assignment covers. Read the
     *      same way the roster is: an empty list on the assignment side means
     *      "no restriction", so a tutor with no sitting chosen still sees an
     *      office upload for any sitting at their level and branch.
     * Batch lives outside SQL (see matchesBatch) and is applied after.
     */
    const lecturer = await prisma.lecturer.findUnique({ where: { id: lecturerId } });
    const assignment = readAssignment(lecturer);

    const where: Record<string, unknown> = { lecturerId };
    if (isAssigned(assignment)) {
      const officeClause: Record<string, unknown> = {
        uploadedBy: { not: null },
        lecturerId: null,
        level: { in: assignment.levels },
        OR: [{ branchId: null }, { branchId: { in: assignment.branchIds } }],
      };
      if (assignment.sessionSlots.length) {
        officeClause.AND = [
          { OR: [{ sessionSlot: null }, { sessionSlot: { in: assignment.sessionSlots } }] },
        ];
      }
      where.OR = [{ lecturerId }, officeClause];
      delete where.lecturerId;
    }

    const rows = await prisma.material.findMany({
      where: where as never,
      include: { course: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const allowedBatches = assignmentBatches(assignment).map((b) => b.toLowerCase());
    const materials = rows.filter((material) => {
      // Only office cohort uploads carry a batch to check; a tutor's own
      // uploads and by-name uploads always pass.
      if (!material.batch || (material.lecturerId && material.lecturerId === lecturerId)) return true;
      if (!allowedBatches.length) return true;
      return allowedBatches.includes(material.batch.toLowerCase());
    });

    return NextResponse.json({
      materials: materials.map((material) => serialise(material, lecturerId)),
      // The level this tutor's own class is at, so the upload form can default
      // to it instead of making every upload start with an empty dropdown. A
      // tutor assigned to more than one level gets the first — still right
      // more often than blank, and the dropdown stays editable.
      assignedLevel: assignment.levels[0] ?? null,
      // The classes this tutor can aim an upload at — one per BATCH they teach —
      // so the form can offer "A1 · Morning · October batch" instead of leaving
      // every upload to reach the whole level.
      classes: lecturer
        ? (
            await tutorTeachingGroups(
              lecturer,
              new Map((await prisma.branch.findMany({ select: { id: true, name: true } })).map((b) => [b.id, b.name])),
            )
          ).map((group) => ({
            key: group.key,
            label: group.label,
            level: group.level,
            batch: group.batch,
            branchName: group.branchName,
          }))
        : [],
    });
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
    const audioEmbed = sourceUrl && !embed ? parseAudioLink(sourceUrl) : null;
    if (sourceUrl && !embed && !audioEmbed) {
      return NextResponse.json(
        { error: 'That link is not a video or audio we recognise. Paste a YouTube, Vimeo, Loom or Drive video; a SoundCloud or Spotify link; or a direct .mp4 / .mp3 URL.' },
        { status: 400 },
      );
    }
    const link = embed ?? audioEmbed;

    const fileUrl = link ? link.sourceUrl : String(body.fileUrl ?? '').trim();
    const fileName = link ? link.label : String(body.fileName ?? '').trim();
    const fileType = embed
      ? EMBED_FILE_TYPE
      : audioEmbed
        ? AUDIO_EMBED_FILE_TYPE
        : String(body.fileType ?? '').trim() || 'application/octet-stream';
    // A link occupies no storage. Recording it as 0 keeps the tutor's "MB used"
    // honest rather than inventing a size for something we do not host.
    const fileSize = link ? 0 : Number(body.fileSize) || 0;

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

    // Tutors teach German classes by level, not a course catalogue — level is
    // the only thing that has to be chosen for a material to reach students.
    const kind = isRecording ? 'recording' : deriveMaterialKind(fileType);
    if (!level) {
      return NextResponse.json({ error: 'Please choose the level this material is for' }, { status: 400 });
    }

    /**
     * WHICH CLASS IS THIS FOR.
     *
     * A tutor with September AND October students must say which: an upload aimed
     * at "the level" reaches both batches and buzzes both phones. `classKey` is
     * one of their own classes (branchId:LEVEL:slot:Batch, the same key the
     * Go-live button uses) or "all" for every class they teach. Omitting it is
     * refused when the tutor has more than one class — the form always sends it —
     * and is the old level-wide behaviour for a tutor with a single class.
     */
    const lecturerRow = await prisma.lecturer.findUnique({ where: { id: lecturerId } });
    const assignmentForUpload = readAssignment(lecturerRow);
    const branchRows = await prisma.branch.findMany({ select: { id: true, name: true } });
    const branchNames = new Map(branchRows.map((b) => [b.id, b.name]));
    const classKey = String(body.classKey ?? '').trim();
    let targetBatch = '';
    let targetLevel = level;
    if (classKey && classKey !== 'all') {
      const parsed = parseGroupKey(classKey);
      const group = parsed ? assignmentHasGroup(assignmentForUpload, branchNames, parsed, lecturerId) : null;
      if (!group) {
        return NextResponse.json({ error: 'That is not one of your classes.' }, { status: 403 });
      }
      targetBatch = canonicalBatch(group.batch);
      targetLevel = group.level;
    } else if (!classKey && lecturerRow) {
      const mine = await tutorTeachingGroups(lecturerRow, branchNames);
      if (mine.length > 1) {
        return NextResponse.json(
          { error: 'Choose which class this material is for, or "all my classes". It would otherwise reach every batch.' },
          { status: 400 },
        );
      }
    }

    const material = await prisma.material.create({
      data: {
        title,
        description: description || null,
        courseId: courseId || null,
        lecturerId,
        // Aimed at one batch: the student's Materials and Watch shelf only show
        // it to that batch. null = every batch, as before.
        batch: targetBatch || null,
        fileName,
        filePath: fileUrl,
        fileType,
        fileSize,
        kind,
        level: targetLevel,
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
        select: { id: true, level: true, admission: true, tutorId: true, coTutors: { select: { lecturerId: true } } },
      });
      // Only the students the upload is FOR: at the chosen level, and — when the
      // tutor aimed it at one class — in that batch (strict: a student with no
      // batch on record is not guessed into it).
      const aimedAtOneClass = Boolean(classKey) && classKey !== 'all';
      const studentIds = recipients
        .filter((student) => belongsToLecturer(assignment, lecturerId, student))
        .filter((student) => !aimedAtOneClass || student.level.toUpperCase() === targetLevel.toUpperCase())
        .filter((student) => !targetBatch || batchOfAdmission(student.admission) === targetBatch)
        .map((student) => student.id);

      if (studentIds.length) {
        // A hybrid student has two tutors: say which one uploaded this. The
        // list itself already tags it (api/student/materials); the push that
        // announces it has to agree, or the first thing they read is vaguer
        // than what they find when they open it.
        const groups = await groupStudentsByTutorPhrase(studentIds, lecturerId);
        for (const [phrase, ids] of groups) {
          if (!ids.length) continue;
          const lowerPhrase = phrase.charAt(0).toLowerCase() + phrase.slice(1);
          await notify({
            to: { studentIds: ids },
            kind: KIND.materialPublished,
            severity: "info",
            title:
              kind === "recording"
                ? "A class recording is up"
                : phrase === "Your tutor"
                  ? "New material from your tutor"
                  : `New material from ${lowerPhrase}`,
            message:
              kind === "recording"
                ? `“${title}” is in your video library. If you missed the class, it starts where you left off.`
                : `${phrase} uploaded “${title}”. Open Materials to download it.`,
            link: kind === "recording" ? "/materials?tab=watch" : "/materials",
            push: true,
            // One announcement per material, so a tutor who saves twice does not
            // buzz two hundred phones twice.
            dedupeKey: `material:${material.id}`,
          }).catch((error) => console.error("Material notification failed", error));
        }
      }
    }

    /**
     * Start the AI read now rather than waiting for the 6am cron — a handout
     * uploaded at 8am for a 10am class should have its quests and notes drafted
     * in time. `after()` runs it once the response is out; a timeout mid-run
     * leaves `aiState:"pending"` for the cron queue to finish. Recordings,
     * videos, audio and pasted links carry no readable text.
     */
    if (kind !== 'recording' && kind !== 'audio' && kind !== 'video' && !link) {
      after(() =>
        generateForMaterial(material.id, { eager: true }).catch((error) =>
          console.error('material-ai kick failed', material.id, error),
        ),
      );
    }

    return NextResponse.json(serialise(material, lecturerId));
  } catch (error) {
    console.error('Materials POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
