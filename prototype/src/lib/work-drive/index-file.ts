/**
 * Pull readable text out of a freshly uploaded Work Drive file so search can
 * find words inside it, not just in its name.
 *
 * Runs in the background (`after()`), never on the request's critical path: a
 * file that uploaded fine must be usable immediately whether or not the
 * indexer has caught up, and a format with no text (an image, a video) is a
 * normal outcome, not an error.
 *
 * Reuses src/lib/extract-text.ts — the same extraction the material summariser
 * uses — so a PDF reads the same wherever it entered the system.
 */

import { prisma } from "@/lib/prisma";
import { getFile, storageConfigured } from "@/lib/storage";
import { extractText, MAX_PARSED_TEXT_LENGTH } from "@/lib/extract-text";

/** Only these formats carry text worth extracting; the rest are skipped. */
const INDEXABLE = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/)/;

/** Don't pull a 190 MB video into memory to look for words in it. */
const MAX_INDEX_BYTES = 15 * 1024 * 1024;

export async function indexDriveFile(fileId: string): Promise<void> {
  try {
    const file = await prisma.driveFile.findFirst({
      where: { id: fileId, deletedAt: null },
      select: { id: true, name: true, mimeType: true, sizeBytes: true, storageKey: true, tenantId: true },
    });
    if (!file) return;
    if (!INDEXABLE.test((file.mimeType || "").toLowerCase())) return;
    if (Number(file.sizeBytes) > MAX_INDEX_BYTES) return;
    if (!storageConfigured()) return; // local dev with files on disk — skip

    const res = await getFile(file.storageKey.replace(/^\/+/, ""));
    if (!res || !res.ok) return;
    const buffer = Buffer.from(await res.arrayBuffer());

    const text = (await extractText(buffer, file.name, file.mimeType)).trim();
    if (!text) return;

    const capped = text.slice(0, MAX_PARSED_TEXT_LENGTH);

    await prisma.$transaction([
      prisma.driveFile.update({ where: { id: file.id }, data: { textContent: capped } }),
      prisma.driveFileText.upsert({
        where: { fileId: file.id },
        create: { fileId: file.id, content: text.slice(0, 200_000), tenantId: file.tenantId },
        update: { content: text.slice(0, 200_000), extractedAt: new Date() },
      }),
    ]);
  } catch (error) {
    console.error(`work-drive: could not index file ${fileId}`, error);
  }
}
