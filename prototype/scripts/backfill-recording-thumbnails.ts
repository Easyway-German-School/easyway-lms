/**
 * Give every class recording already in the library a poster image.
 *
 * `finaliseRecording` generates one for each new recording from now on, so this
 * is only for the back catalogue. Safe to run more than once: it selects on
 * `thumbnailPath: null`, so a second run picks up only what failed the first
 * time.
 *
 *   npm run backfill:thumbnails
 *
 * WHY runUnscoped: `Material` is a tenant-owned model (see
 * src/lib/tenant/registry.ts), and a bare script has no request-scoped tenant
 * context — every query here would throw TenantIsolationError without it. A
 * backfill legitimately spans every tenant, which is exactly the case that
 * helper exists to document.
 */

import { prisma } from "@/lib/prisma";
import { createRecordingThumbnail } from "@/lib/recording-thumbnail";
import { keyFromUrl, RECORDING_PREFIX } from "@/lib/storage";
import { runUnscoped } from "@/lib/tenant/context";

/** Small, because each item is an upload — this is bucket-bound, not CPU-bound. */
const BATCH_SIZE = 10;
const DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The object key behind a stored recording URL.
 *
 * `keyFromUrl` handles the shapes it knows: `/api/files/<key>` and
 * `/uploads/<key>`. It cannot handle a recording served from its own CDN,
 * because it resolves against the GENERAL bucket's public base and recordings
 * may have a different one (see recordingObjectStorage in storage.ts). So for
 * an absolute URL we fall back to finding the prefix in the path, which is
 * stable regardless of which hostname is in front of it.
 */
function objectKeyFor(filePath: string): string | null {
  const known = keyFromUrl(filePath);
  if (known) return known;

  const at = filePath.indexOf(`/${RECORDING_PREFIX}`);
  return at === -1 ? null : filePath.slice(at + 1);
}

async function main(): Promise<void> {
  const recordings = await prisma.material.findMany({
    // `kind` is the discriminator, not `fileType` — see the note on
    // Material.kind in schema.prisma for why the two are not interchangeable.
    where: { kind: "recording", thumbnailPath: null },
    select: { id: true, title: true, level: true, recordedAt: true, filePath: true },
    orderBy: { recordedAt: "desc" },
  });

  console.log(`${recordings.length} recording(s) without a poster.`);
  if (recordings.length === 0) return;

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < recordings.length; i += BATCH_SIZE) {
    const batch = recordings.slice(i, i + BATCH_SIZE);
    console.log(
      `\nBatch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(recordings.length / BATCH_SIZE)}`,
    );

    // Sequential inside the batch: ten concurrent PUTs to the same bucket is
    // how you earn a rate limit, and there is no deadline on a backfill.
    for (const recording of batch) {
      const label = recording.title.slice(0, 44);
      const objectKey = objectKeyFor(recording.filePath);

      if (!objectKey) {
        skipped += 1;
        console.warn(`  SKIP  ${label} — no object key in ${recording.filePath}`);
        continue;
      }

      try {
        const thumbnailPath = await createRecordingThumbnail({
          objectKey,
          title: recording.title,
          level: recording.level,
          recordedAt: recording.recordedAt ?? new Date(),
        });
        await prisma.material.update({
          where: { id: recording.id },
          data: { thumbnailPath },
        });
        succeeded += 1;
        console.log(`  OK    ${label}`);
      } catch (error) {
        failed += 1;
        console.error(`  FAIL  ${label} — ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (i + BATCH_SIZE < recordings.length) await sleep(DELAY_MS);
  }

  console.log(`\n${succeeded} written, ${skipped} skipped, ${failed} failed.`);
  // exitCode, not exit() — process.exit here would cut the run off before the
  // $disconnect in the finally below.
  if (failed > 0) process.exitCode = 1;
}

runUnscoped("backfill recording posters across every tenant's library", main)
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
