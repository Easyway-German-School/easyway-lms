/**
 * The bits every Work Drive file route shares: what a file's "kind" is, what
 * may be uploaded, and how the activity feed gets a line.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Object-storage prefix for every Work Drive file. See src/lib/storage.ts. */
export const WORK_DRIVE_PREFIX = "work-drive";

/**
 * One file per PUT, and this is the ceiling. 200 MB covers a scanned contract
 * bundle or a short training video and is well under anything that would be a
 * surprise on the storage bill. Enforced at presign (the signature commits to
 * it) and re-checked when the metadata row is written.
 */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * What a signed-in staff member may be handed a signed PUT for.
 *
 * Wider than the media presign route (that one also serves anonymous signup
 * photos) but still a list, not "anything": office documents, the media a
 * school actually produces, archives, and plain text. `application/octet-stream`
 * is deliberately absent — a file with no declared type cannot be shelved,
 * previewed or virus-reasoned-about, so the client must send a real one. A
 * staff member who hits a wall asks for the type to be added; an allowlist that
 * grows by request is the only kind that stays meaningful.
 */
export const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  // images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/tiff",
  "image/heic",
  // video
  "video/mp4",
  "video/webm",
  "video/quicktime",
  // audio
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  // office
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  // text / data
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  // archives
  "application/zip",
  "application/x-zip-compressed",
]);

export function isAllowedContentType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(contentType.toLowerCase().split(";")[0].trim());
}

/**
 * document | spreadsheet | image | video | audio | pdf | archive | other —
 * derived from the MIME type, drives the icon and the type filter. Falls back
 * to the filename extension when the browser sends a vague type.
 */
export function fileKindFor(mimeType: string, filename = ""): string {
  const mime = (mimeType || "").toLowerCase();
  const ext = filename.toLowerCase().split(".").pop() || "";

  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg", "tiff", "heic"].includes(ext))
    return "image";
  if (mime.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) return "video";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "aac"].includes(ext)) return "audio";
  if (
    mime.includes("spreadsheet") ||
    mime === "application/vnd.ms-excel" ||
    mime === "text/csv" ||
    ["xls", "xlsx", "csv", "ods"].includes(ext)
  )
    return "spreadsheet";
  if (
    mime.includes("word") ||
    mime.includes("presentation") ||
    mime === "application/msword" ||
    mime === "application/vnd.ms-powerpoint" ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    ["doc", "docx", "odt", "rtf", "txt", "md", "ppt", "pptx", "odp", "json"].includes(ext)
  )
    return "document";
  if (
    mime === "application/zip" ||
    mime === "application/x-zip-compressed" ||
    ["zip", "rar", "7z", "tar", "gz"].includes(ext)
  )
    return "archive";
  return "other";
}

export type FileActivityAction =
  | "uploaded"
  | "renamed"
  | "moved"
  | "new_version"
  | "deleted"
  | "restored"
  | "shared"
  | "downloaded"
  | "commented";

/**
 * Add a line to a workspace's activity feed.
 *
 * Best-effort and never throws: the feed is a convenience, and a file that
 * uploaded fine must not report a failure because writing the feed row did.
 * The security record is the AuditLog, which the admin gate writes regardless.
 */
export async function logFileActivity(input: {
  workspaceId: string;
  actorId?: string | null;
  action: FileActivityAction;
  fileId?: string | null;
  folderId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.fileActivity.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId ?? null,
        action: input.action,
        fileId: input.fileId ?? null,
        folderId: input.folderId ?? null,
        meta: input.meta ? (input.meta as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (error) {
    console.error("work-drive: could not write activity", error);
  }
}
