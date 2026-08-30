"use client";

import {
  OFFLINE_CAP_BYTES,
  putMedia,
  wouldExceedCap,
  type OfflineMediaMeta,
} from "@/lib/offline/store";
import { formatDuration, type LibraryVideo } from "@/lib/video-library";

/**
 * Pull a file down with a real progress signal.
 *
 * Streams the body so the button shows bytes-in against `Content-Length`
 * rather than sitting frozen for a 200 MB class recording. Falls back to a
 * plain `blob()` when the response has no readable stream (older Safari).
 */
export async function fetchWithProgress(
  url: string,
  onProgress?: (fraction: number, receivedBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);

  const total = Number(response.headers.get("Content-Length")) || 0;
  if (!response.body || typeof response.body.getReader !== "function") {
    const blob = await response.blob();
    onProgress?.(1, blob.size, blob.size || total);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onProgress?.(total ? received / total : 0, received, total);
    }
  }
  const type = response.headers.get("Content-Type") || "video/mp4";
  return new Blob(chunks, { type });
}

export class OfflineCapError extends Error {
  constructor() {
    super(
      `Your offline library is full (${Math.round(OFFLINE_CAP_BYTES / 1024 / 1024 / 1024)} GB). ` +
        `Delete a download to make room.`,
    );
    this.name = "OfflineCapError";
  }
}

/**
 * Download one library video for offline watching and file it in IndexedDB.
 * `expiresAtISO` comes from the video's `expiresAt` (a recording's 14-day
 * window); pass null for anything that should stay until the student deletes it.
 */
export async function downloadVideoForOffline(
  video: LibraryVideo,
  opts: {
    onProgress?: (fraction: number, received: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  if (video.embedUrl) throw new Error("Videos hosted elsewhere can't be saved for offline.");

  // A recording carries a rough size on the tile via duration; we can't know
  // the exact bytes until the headers arrive, so the hard cap check runs
  // again mid-stream is not worth it — check the current total is not already
  // at the ceiling, then let the stream finish.
  if (await wouldExceedCap(0)) throw new OfflineCapError();

  const blob = await fetchWithProgress(video.fileUrl, opts.onProgress, opts.signal);

  if (await wouldExceedCap(blob.size)) throw new OfflineCapError();

  let thumbBlob: Blob | null = null;
  if (video.thumbnailUrl) {
    try {
      const res = await fetch(video.thumbnailUrl, { credentials: "include", signal: opts.signal });
      if (res.ok) thumbBlob = await res.blob();
    } catch {
      thumbBlob = null;
    }
  }

  const meta: OfflineMediaMeta = {
    title: video.title,
    kind: video.kind,
    level: video.level,
    durationSeconds: video.durationSeconds,
    isPrivate: video.isPrivate,
    lecturerName: video.lecturerName,
    recordedAt: video.recordedAt,
  };

  await putMedia({
    materialId: video.id,
    blob,
    thumbBlob,
    meta,
    downloadedAt: Date.now(),
    expiresAt: video.expiresAt ? new Date(video.expiresAt).getTime() : null,
    sizeBytes: blob.size,
  });
}

/** "128 MB", "1.4 GB" — for the button and the offline shelf. */
export function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** "expires in 3 days" / "expires today" / "" — recording shelf-life copy. */
export function expiryLabel(expiresAt: number | null, now: number = Date.now()): string {
  if (expiresAt == null) return "";
  const days = Math.ceil((expiresAt - now) / 86_400_000);
  if (days <= 0) return "expired";
  if (days === 1) return "leaves your library tomorrow";
  return `leaves your library in ${days} days`;
}

export { formatDuration };
