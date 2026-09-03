/**
 * Work Drive housekeeping, run from the cron tick.
 *
 *   purgeExpiredTrash   files soft-deleted more than TRASH_DAYS ago are hard-
 *                       deleted — the row and the object both go. Mirrors the
 *                       30-day grace the portal lock uses.
 *   pruneOldVersions    a file with more than KEEP_VERSIONS versions loses the
 *                       oldest, object and all, keeping the newest KEEP_VERSIONS
 *                       and anything newer than VERSION_DAYS. The current
 *                       version is never touched.
 *
 * Cron has no tenant in context, so every query is explicitly unscoped.
 */

import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant/context";
import { deleteFile } from "@/lib/storage";

export const TRASH_DAYS = 30;
export const KEEP_VERSIONS = 10;
export const VERSION_DAYS = 90;

/** Hard-delete files that have been in a workspace trash past the grace period. */
export async function purgeExpiredTrash(limit = 200): Promise<{ purged: number; objects: number }> {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86400_000);

  const files = await runUnscoped("cron: work-drive trash purge", () =>
    prisma.driveFile.findMany({
      // The guard rewrites reads to hide deletedAt rows, so ask through the raw
      // client — this is the one place that WANTS the tombstones.
      where: { deletedAt: { lte: cutoff } },
      orderBy: { deletedAt: "asc" },
      take: limit,
      select: { id: true, storageKey: true, versions: { select: { id: true, storageKey: true } } },
    }),
  );

  let objects = 0;
  for (const f of files) {
    const keys = new Set<string>([f.storageKey, ...f.versions.map((v) => v.storageKey)].map((k) => k.replace(/^\/+/, "")));
    for (const key of keys) {
      if (await deleteFile(key)) objects++;
    }
    // A genuine hard delete: bypass the soft-delete guard with a raw statement.
    await runUnscoped("cron: work-drive trash purge (row)", () =>
      prisma.$executeRaw`DELETE FROM "DriveFile" WHERE "id" = ${f.id}`,
    );
  }

  return { purged: files.length, objects };
}

/** Drop the oldest surplus versions of any file that has accumulated too many. */
export async function pruneOldVersions(limit = 100): Promise<{ filesChecked: number; versionsDropped: number }> {
  const cutoff = new Date(Date.now() - VERSION_DAYS * 86400_000);

  const files = await runUnscoped("cron: work-drive version prune", () =>
    prisma.driveFile.findMany({
      where: { deletedAt: null, versions: { some: {} } },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: {
        id: true,
        currentVersionId: true,
        versions: { orderBy: { versionNumber: "desc" }, select: { id: true, storageKey: true, createdAt: true } },
      },
    }),
  );

  let dropped = 0;
  for (const f of files) {
    if (f.versions.length <= KEEP_VERSIONS) continue;
    // Keep the newest KEEP_VERSIONS, keep anything newer than the cutoff, and
    // never touch the current version.
    const surplus = f.versions.slice(KEEP_VERSIONS).filter((v) => v.id !== f.currentVersionId && v.createdAt < cutoff);
    for (const v of surplus) {
      await deleteFile(v.storageKey.replace(/^\/+/, "")).catch(() => false);
      await runUnscoped("cron: work-drive version prune (row)", () =>
        prisma.driveFileVersion.delete({ where: { id: v.id } }),
      );
      dropped++;
    }
  }

  return { filesChecked: files.length, versionsDropped: dropped };
}
