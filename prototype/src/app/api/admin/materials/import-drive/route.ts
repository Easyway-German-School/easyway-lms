import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse, after } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { KIND, notify } from "@/lib/notify";
import { BATCHES, COURSE_LEVELS, SESSION_SLOTS } from "@/lib/lecturer-assignment";
import {
  studentIdsForMaterial,
  tutorUserIdsForMaterial,
  MATERIAL_AUDIENCE_SELECT,
} from "@/lib/material-audience";
import {
  DriveApiError,
  driveFileToMaterialFields,
  listDriveFolderFiles,
  parseDriveFolderId,
} from "@/lib/drive-import";

/**
 * POST /api/admin/materials/import-drive
 *
 * Body: { folderUrl, courseId?, level?, branchId?, sessionSlot?, batch?,
 *         lecturerId?, visibleToStudents? } — the same targeting the single
 * office upload takes (see /api/admin/materials), minus title/description.
 *
 * Lists every file under the shared Drive folder and creates one Material row
 * per file, each stored as a link (nothing is copied). One summary
 * notification goes out in the background, not one per file.
 */

function pickOne(value: unknown, allowed: readonly string[]): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const hit = allowed.find((option) => option.toLowerCase() === raw.toLowerCase());
  return hit ?? null;
}

/** Insert in small parallel groups — 200 awaited one by one is a needless wait. */
async function createInChunks<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const group = items.slice(i, i + size);
    out.push(...(await Promise.all(group.map(fn))));
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requireCapability("materials");
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));

    const folderId = parseDriveFolderId(String(body.folderUrl ?? ""));
    if (!folderId) {
      return NextResponse.json(
        {
          error:
            "That is not a Google Drive folder link. Open the folder in Drive and copy the URL from the address bar — it has /folders/ in it.",
        },
        { status: 400 },
      );
    }

    const apiKey =
      process.env.GOOGLE_DRIVE_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || "";
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Google Drive import isn't switched on yet. Add GOOGLE_DRIVE_API_KEY (a Google Cloud API key with the Drive API enabled) to the environment.",
        },
        { status: 501 },
      );
    }

    // ---- Targeting — mirrors /api/admin/materials -----------------------
    const courseId = String(body.courseId ?? "").trim();
    const targetLevel = pickOne(body.level, COURSE_LEVELS);
    const branchId = String(body.branchId ?? "").trim() || null;
    const sessionSlot = pickOne(body.sessionSlot, SESSION_SLOTS);
    const batch = pickOne(body.batch, BATCHES);
    const lecturerId = String(body.lecturerId ?? "").trim() || null;
    const visibleToStudents =
      body.visibleToStudents === undefined ? true : body.visibleToStudents !== false;

    if (!courseId && !targetLevel) {
      return NextResponse.json(
        { error: "Choose a course, or the level these materials are for" },
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
      resolvedLevel = resolvedLevel || (course.level ? course.level.toUpperCase() : null);
    }

    if (lecturerId) {
      const lecturer = await prisma.lecturer.findUnique({
        where: { id: lecturerId },
        select: { id: true },
      });
      if (!lecturer) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
    }

    // ---- List the folder ----------------------------------------------
    let listing;
    try {
      listing = await listDriveFolderFiles(folderId, apiKey);
    } catch (error) {
      if (error instanceof DriveApiError) {
        if (error.status === 404) {
          return NextResponse.json(
            {
              error:
                "Couldn't open that folder. In Drive, set it to “Anyone with the link” and paste the link again.",
            },
            { status: 404 },
          );
        }
        if (error.status === 401 || error.status === 403) {
          return NextResponse.json(
            {
              error:
                "Google refused the request. The API key is restricted or the Drive API isn't enabled for it.",
            },
            { status: 502 },
          );
        }
        return NextResponse.json(
          { error: `Google Drive error (${error.status}). Try again in a moment.` },
          { status: 502 },
        );
      }
      throw error;
    }

    if (listing.files.length === 0) {
      return NextResponse.json(
        {
          error:
            "That folder has no files to import — it is empty, or it only contains sub-folders that are empty.",
        },
        { status: 422 },
      );
    }

    // ---- Create the rows --------------------------------------------------
    const created = await createInChunks(listing.files, 10, async (file) => {
      const fields = driveFileToMaterialFields(file);
      return prisma.material.create({
        data: {
          courseId: courseId || null,
          lecturerId: lecturerId || null,
          title: fields.fileName.replace(/\.[^.]+$/, ""),
          description: null,
          filePath: fields.filePath,
          fileName: fields.fileName,
          fileType: fields.fileType,
          fileSize: fields.fileSize,
          uploadedBy: gate.session.user.id,
          kind: fields.kind,
          level: resolvedLevel,
          branchId,
          sessionSlot,
          batch,
          visibleToStudents,
          // Nothing to read — see the `link/` branch in material-ai.ts.
          aiState: "none",
        },
        select: { id: true },
      });
    });

    const tally = listing.files.reduce(
      (acc, file) => {
        const kind = driveFileToMaterialFields(file).kind;
        acc[kind] += 1;
        return acc;
      },
      { video: 0, audio: 0, document: 0 },
    );

    // One notification for the batch, in the background — never one per file.
    after(() =>
      announceImport(created[0]?.id, created.length, resolvedLevel).catch((error) =>
        console.error("Drive import announcement failed", error),
      ),
    );

    return NextResponse.json({
      imported: created.length,
      folderName: listing.folderName,
      truncated: listing.truncated,
      tally,
    });
  } catch (error) {
    console.error("Drive folder import failed:", error);
    return NextResponse.json({ error: "Drive folder import failed" }, { status: 500 });
  }
}

/**
 * Tell the class (and its tutors) that a stack of new material landed. Reuses
 * the one material-audience resolver so a Drive import reaches exactly who a
 * hand upload to the same cohort would.
 */
async function announceImport(
  sampleId: string | undefined,
  count: number,
  level: string | null,
): Promise<void> {
  if (!sampleId || count === 0) return;

  const sample = await prisma.material.findUnique({
    where: { id: sampleId },
    select: MATERIAL_AUDIENCE_SELECT,
  });
  if (!sample) return;

  const where = level ? `your ${level} library` : "your library";
  const noun = count === 1 ? "material" : "materials";

  const tutorUserIds = await tutorUserIdsForMaterial(sample);
  if (tutorUserIds.length) {
    await notify({
      to: { userIds: tutorUserIds },
      kind: KIND.materialPublished,
      severity: "info",
      title: sample.lecturerId ? "New materials from the office" : "New materials for your class",
      message: `${count} new ${noun} were added for your class. Open Materials to see them.`,
      link: "/lecturer/materials",
      push: true,
      dedupeKey: `drive-import:${sampleId}:tutors`,
    }).catch((error) => console.error("Tutor drive-import notification failed", error));
  }

  // studentIdsForMaterial returns [] when the upload is staff-only.
  const studentIds = await studentIdsForMaterial(sample);
  if (studentIds.length) {
    await notify({
      to: { studentIds },
      kind: KIND.materialPublished,
      severity: "info",
      title: "New course materials",
      message: `${count} new ${noun} were added to ${where}. Open Materials to see them.`,
      link: "/materials",
      push: true,
      dedupeKey: `drive-import:${sampleId}:students`,
    }).catch((error) => console.error("Student drive-import notification failed", error));
  }
}
