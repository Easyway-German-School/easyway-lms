import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse, after } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { KIND, notify } from "@/lib/notify";
import { deriveMaterialKind } from "@/lib/video-library";
import { EMBED_FILE_TYPE, parseEmbed } from "@/lib/media-embed";
import { BATCHES, COURSE_LEVELS, SESSION_SLOTS } from "@/lib/lecturer-assignment";
import { generateForMaterial } from "@/lib/material-ai";
import {
  studentIdsForMaterial,
  tutorUserIdsForMaterial,
  type MaterialAudienceRow,
} from "@/lib/material-audience";

async function requireMaterialsAdmin() {
  return requireCapability("materials");
}

function pickOne(value: unknown, allowed: readonly string[]): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const hit = allowed.find((option) => option.toLowerCase() === raw.toLowerCase());
  return hit ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const gate = await requireMaterialsAdmin();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const courseId = searchParams.get("courseId");

    const where = courseId ? { courseId } : {};

    const materials = await prisma.material.findMany({
      where,
      include: {
        course: {
          select: { title: true, level: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(materials);
  } catch (error) {
    console.error("Error fetching materials:", error);
    return NextResponse.json({ error: "Failed to fetch materials" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requireMaterialsAdmin();
    if (!gate.ok) return gate.response;

    /**
     * The browser has already put the file in the bucket (see lib/upload.ts)
     * and sends only the metadata, because a request body through Vercel is
     * capped at 4.5 MB and course material routinely is not. A pasted link is
     * the alternative to a file — nothing was uploaded, the fields are
     * synthesised from the parsed link. Mirrors /api/lecturer/materials.
     */
    const body = await req.json().catch(() => ({}));

    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "").trim();
    const courseId = String(body.courseId ?? "").trim();

    const sourceUrl = String(body.sourceUrl ?? "").trim();
    const embed = sourceUrl ? parseEmbed(sourceUrl) : null;
    if (sourceUrl && !embed) {
      return NextResponse.json(
        {
          error:
            "That link is not a video we recognise. Paste a YouTube, Vimeo, Loom or Google Drive link, or a direct .mp4 URL.",
        },
        { status: 400 },
      );
    }

    const fileUrl = embed ? embed.sourceUrl : String(body.fileUrl ?? "").trim();
    const fileName = embed ? embed.label : String(body.fileName ?? "").trim();
    const fileType = embed
      ? EMBED_FILE_TYPE
      : String(body.fileType ?? "").trim() || fileName.split(".").pop() || "application/octet-stream";
    const fileSize = embed ? 0 : Number(body.fileSize) || 0;

    if (!title || !fileUrl || !fileName) {
      return NextResponse.json(
        { error: "A title and either a file or a video link are required" },
        { status: 400 },
      );
    }

    // ---- Targeting -------------------------------------------------------
    const targetLevel = pickOne(body.level, COURSE_LEVELS);
    const branchId = String(body.branchId ?? "").trim() || null;
    const sessionSlot = pickOne(body.sessionSlot, SESSION_SLOTS);
    const batch = pickOne(body.batch, BATCHES);
    const lecturerId = String(body.lecturerId ?? "").trim() || null;
    // Default true — the office ticks this off to keep a resource staff-only.
    const visibleToStudents = body.visibleToStudents === undefined ? true : body.visibleToStudents !== false;

    const isRecording = String(body.isRecording ?? "") === "true";
    const series = String(body.series ?? "").trim() || null;
    const episodeRaw = String(body.episodeNumber ?? "").trim();
    const recordedAtRaw = String(body.recordedAt ?? "").trim();
    const durationRaw = String(body.durationSeconds ?? "").trim();

    const kind = isRecording ? "recording" : deriveMaterialKind(fileType);

    // A material has to land somewhere findable: either it belongs to a course
    // (students of that course's level get it) or it names the level directly.
    if (!courseId && !targetLevel) {
      return NextResponse.json(
        { error: "Choose a course, or the level this material is for" },
        { status: 400 },
      );
    }

    let resolvedLevel = targetLevel;
    if (courseId) {
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, level: true },
      });
      if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });
      // The level is always stamped on the row — see the note in
      // /api/lecturer/materials: student visibility must not rest on a join to
      // course.level staying correct forever.
      resolvedLevel = resolvedLevel || (course.level ? course.level.toUpperCase() : null);
    }

    if (lecturerId) {
      const lecturer = await prisma.lecturer.findUnique({
        where: { id: lecturerId },
        select: { id: true },
      });
      if (!lecturer) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
    }

    const material = await prisma.material.create({
      data: {
        courseId: courseId || null,
        // When the office aims an upload at one named tutor, it is owned by
        // that tutor exactly as if they had uploaded it themselves — it shows
        // in their portal through the ordinary `lecturerId` path.
        lecturerId: lecturerId || null,
        title,
        description: description || null,
        filePath: fileUrl,
        fileName,
        fileType,
        fileSize,
        uploadedBy: gate.session.user.id,
        kind,
        level: resolvedLevel,
        branchId,
        sessionSlot,
        batch,
        visibleToStudents,
        series,
        episodeNumber: episodeRaw ? Number(episodeRaw) || null : null,
        durationSeconds: durationRaw ? Number(durationRaw) || null : null,
        recordedAt: recordedAtRaw
          ? new Date(recordedAtRaw)
          : kind === "recording"
            ? new Date()
            : null,
        thumbnailPath: embed?.thumbnailUrl ?? null,
      },
      include: { course: { select: { title: true, level: true } } },
    });

    await announce(material).catch((error) => console.error("Material announcement failed", error));

    /**
     * Start the AI read now, not on the 6am cron.
     *
     * `generateForMaterial` produces the summary, key points, quests and
     * study-notes; it then nudges the assigned tutor(s) to sign them off (see
     * material-ai.ts). Running it in `after()` keeps the upload response fast;
     * if it times out mid-generation the row is left at `aiState:"pending"`,
     * which the cron queue picks up and finishes. A recording carries no text,
     * so there is nothing to read.
     */
    if (kind !== "recording") {
      after(() =>
        generateForMaterial(material.id).catch((error) =>
          console.error("material-ai kick failed", material.id, error),
        ),
      );
    }

    return NextResponse.json(material);
  } catch (error) {
    console.error("Error uploading material:", error);
    return NextResponse.json({ error: "Failed to upload material" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const gate = await requireMaterialsAdmin();
    if (!gate.ok) return gate.response;

    const { id } = await req.json().catch(() => ({}));
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const material = await prisma.material.findUnique({ where: { id }, select: { id: true } });
    if (!material) return NextResponse.json({ error: "Material not found" }, { status: 404 });

    /**
     * Soft delete only — the row leaves every list but is restorable from the
     * audit trail (prisma-guard rewrites this `delete` into `deletedAt = now`).
     * The stored file is deliberately left in the bucket: reclaiming it here
     * would make "restore" hand back a row pointing at nothing. A retention
     * job sweeps orphaned objects separately.
     */
    await prisma.material.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting material:", error);
    return NextResponse.json({ error: "Failed to delete material" }, { status: 500 });
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Tell the people a new material is for that it exists.
 *
 * Audience is resolved through `@/lib/material-audience` — the one place that
 * knows a tutor upload goes to that tutor's roster while an office cohort
 * upload goes to every assigned tutor for the class (and its students, unless
 * it is staff-only).
 */
async function announce(
  material: MaterialAudienceRow & { title: string; kind: string },
): Promise<void> {
  const notifyLink = material.kind === "recording" ? "/materials?tab=watch" : "/materials";

  const tutorUserIds = await tutorUserIdsForMaterial(material);
  if (tutorUserIds.length) {
    await notify({
      to: { userIds: tutorUserIds },
      kind: KIND.materialPublished,
      severity: "info",
      title: material.lecturerId ? "New material from the office" : "New material for your class",
      message: `“${material.title}” was added for your class. Open Materials to see it.`,
      link: notifyLink,
      push: true,
      dedupeKey: `material:${material.id}:tutors`,
    }).catch((error) => console.error("Tutor material notification failed", error));
  }

  const studentIds = await studentIdsForMaterial(material);
  if (studentIds.length) {
    await notify({
      to: { studentIds },
      kind: KIND.materialPublished,
      severity: "info",
      title: material.kind === "recording" ? "A class recording is up" : "New course material",
      message:
        material.kind === "recording"
          ? `“${material.title}” is in your video library.`
          : `“${material.title}” was added to your Materials. Open it to download.`,
      link: notifyLink,
      push: true,
      dedupeKey: `material:${material.id}:students`,
    }).catch((error) => console.error("Student material notification failed", error));
  }
}
