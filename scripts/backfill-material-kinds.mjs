/**
 * Tags materials uploaded before the video library existed.
 *
 * Every existing row defaults to `kind: "document"`, so videos already in the
 * database would never appear on the Watch tab. This reads their MIME type and
 * promotes the real videos, and copies the course level down onto the row so
 * the library's level filter can find them.
 *
 * Idempotent. Run with: node scripts/backfill-material-kinds.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".ogg", ".ogv", ".mov", ".m4v", ".mkv"];

/**
 * Is this row really a video?
 *
 * The declared `fileType` alone is not trustworthy: the demo seed wrote
 * `fileType: "video"` onto rows whose file is a .pdf, and promoting those puts
 * tiles in the library that can never play. When the filename carries an
 * extension it is the authority, because it reflects the bytes on disk.
 */
function isVideo(fileType, filePath) {
  const path = String(filePath ?? "").toLowerCase();
  const dot = path.lastIndexOf(".");
  if (dot > -1) {
    return VIDEO_EXTENSIONS.includes(path.slice(dot));
  }

  const type = String(fileType ?? "").toLowerCase();
  return type.startsWith("video/") || type === "video";
}

async function main() {
  const materials = await prisma.material.findMany({
    include: { course: { select: { level: true } } },
  });

  let promoted = 0;
  let demoted = 0;
  let levelled = 0;

  for (const material of materials) {
    const shouldBeVideo = isVideo(material.fileType, material.filePath);
    const data = {};

    if (shouldBeVideo && material.kind === "document") {
      data.kind = "video";
      promoted += 1;
    }

    // Send back anything an earlier run promoted on a bad `fileType`. A
    // recording is left alone — that is a tutor's explicit choice, not
    // something to overrule from a filename.
    if (!shouldBeVideo && material.kind === "video") {
      data.kind = "document";
      demoted += 1;
    }

    if (!material.level && material.course?.level) {
      data.level = material.course.level;
      levelled += 1;
    }

    if (Object.keys(data).length > 0) {
      await prisma.material.update({ where: { id: material.id }, data });
    }
  }

  console.log(`Checked ${materials.length} materials.`);
  console.log(`Promoted ${promoted} to videos, sent ${demoted} back to documents, filled in ${levelled} missing levels.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
