/**
 * Import a whole Google Drive folder as course materials.
 *
 * The office keeps a term's worth of worksheets, slide decks and clips in a
 * shared Drive folder. Uploading them one at a time — or even folder-picking
 * them off a laptop — is the work nobody wants. Paste the folder's share link
 * instead and every file inside becomes its own Material row.
 *
 * Nothing is copied. Each file is stored as a link the same way a pasted
 * YouTube or single Drive video already is (see media-embed.ts): the student
 * opens it from where it lives. Re-hosting 50 files, some of them 300 MB, over
 * a Nigerian connection is exactly what this feature exists to avoid.
 *
 * This module is import-safe on the client — it only parses strings and calls
 * `fetch`. The API route is the only place that supplies the API key.
 */

import { AUDIO_EMBED_FILE_TYPE, EMBED_FILE_TYPE } from "@/lib/media-embed";

/** Non-media Drive files (PDF, DOCX, a Google Doc…) carry this as `fileType`. */
export const DRIVE_LINK_FILE_TYPE = "link/drive";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

/** How much of one folder we will take in a single import. */
export const DRIVE_IMPORT_MAX_FILES = 500;
/** How deep we will follow sub-folders. */
export const DRIVE_IMPORT_MAX_DEPTH = 6;

/**
 * The folder id out of any shape of Drive folder URL, or null if it is not a
 * folder link at all (a `/file/d/` link is a single file — that path already
 * exists as "Paste a link").
 */
export function parseDriveFolderId(rawUrl: string): string | null {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host !== "drive.google.com") return null;

  // .../folders/<id>  and  .../drive/u/0/folders/<id>
  const inPath = url.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (inPath) return inPath[1];

  // .../open?id=<id>  (Drive hands this out for "Get link" on some folders)
  if (/\/(open|drive)\b/.test(url.pathname)) {
    const id = url.searchParams.get("id");
    if (id) return id;
  }

  return null;
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes. Absent for Google-native docs, which have no byte size. */
  size?: number;
};

export type DriveListing = {
  files: DriveFile[];
  /** The folder's own name, for the "Imported 24 files from …" line. */
  folderName: string | null;
  /** True when the folder held more than DRIVE_IMPORT_MAX_FILES. */
  truncated: boolean;
};

/** A non-2xx from the Drive API, carried out so the route can phrase it. */
export class DriveApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`Drive API ${status}: ${body.slice(0, 300)}`);
    this.name = "DriveApiError";
    this.status = status;
  }
}

/**
 * Every file under a folder, following sub-folders breadth-first. Shortcuts are
 * resolved to their target. Trashed items are skipped by the query.
 */
export async function listDriveFolderFiles(
  folderId: string,
  apiKey: string,
  opts: { maxFiles?: number; maxDepth?: number } = {},
): Promise<DriveListing> {
  const maxFiles = opts.maxFiles ?? DRIVE_IMPORT_MAX_FILES;
  const maxDepth = opts.maxDepth ?? DRIVE_IMPORT_MAX_DEPTH;

  const files: DriveFile[] = [];
  let truncated = false;

  let folderName: string | null = null;
  try {
    const metaRes = await fetch(
      `${DRIVE_API}/${encodeURIComponent(folderId)}?fields=name&supportsAllDrives=true&key=${apiKey}`,
    );
    if (metaRes.ok) folderName = (await metaRes.json())?.name ?? null;
    else if (metaRes.status === 404) throw new DriveApiError(404, await metaRes.text().catch(() => ""));
  } catch (error) {
    if (error instanceof DriveApiError) throw error;
    // A flaky name lookup is not worth failing the whole import over.
  }

  const queue: Array<{ id: string; depth: number }> = [{ id: folderId, depth: 0 }];
  const seen = new Set<string>();

  while (queue.length && !truncated) {
    const { id, depth } = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);

    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${id}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,size,shortcutDetails)",
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        key: apiKey,
      });
      if (pageToken) params.set("pageToken", pageToken);

      const res = await fetch(`${DRIVE_API}?${params.toString()}`);
      if (!res.ok) throw new DriveApiError(res.status, await res.text().catch(() => ""));

      const data = (await res.json()) as {
        nextPageToken?: string;
        files?: Array<
          DriveFile & {
            shortcutDetails?: { targetId?: string; targetMimeType?: string };
          }
        >;
      };

      for (const entry of data.files ?? []) {
        let { id: fileId, name, mimeType } = entry;
        let size = entry.size;

        if (mimeType === SHORTCUT_MIME && entry.shortcutDetails) {
          fileId = entry.shortcutDetails.targetId ?? fileId;
          mimeType = entry.shortcutDetails.targetMimeType ?? mimeType;
        }

        if (mimeType === FOLDER_MIME) {
          if (depth < maxDepth) queue.push({ id: fileId, depth: depth + 1 });
          continue;
        }

        if (files.length >= maxFiles) {
          truncated = true;
          break;
        }

        files.push({
          id: fileId,
          name: name?.trim() || "Untitled",
          mimeType: mimeType || "application/octet-stream",
          size: size == null ? undefined : Number(size) || undefined,
        });
      }

      pageToken = truncated ? undefined : data.nextPageToken;
    } while (pageToken);
  }

  return { files, folderName, truncated };
}

export type DriveMaterialFields = {
  filePath: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  kind: "video" | "audio" | "document";
};

/** The viewer URL for a file, picked so the link opens cleanly for a student. */
function driveViewUrl(id: string, mimeType: string): string {
  if (mimeType === "application/vnd.google-apps.document")
    return `https://docs.google.com/document/d/${id}/view`;
  if (mimeType === "application/vnd.google-apps.spreadsheet")
    return `https://docs.google.com/spreadsheets/d/${id}/view`;
  if (mimeType === "application/vnd.google-apps.presentation")
    return `https://docs.google.com/presentation/d/${id}/view`;
  return `https://drive.google.com/file/d/${id}/view`;
}

/**
 * Turn one Drive file into the columns a Material row needs.
 *
 * Video and audio reuse the existing embed types so they slot into the video
 * library and the audio list untouched. Everything else is `link/drive`, a
 * marker `material-ai` skips (there are no bytes to read) and the student
 * documents list renders with an "Open" that points at Drive.
 */
export function driveFileToMaterialFields(file: DriveFile): DriveMaterialFields {
  const mime = file.mimeType || "";

  if (mime.startsWith("video/")) {
    return {
      filePath: `https://drive.google.com/file/d/${file.id}/preview`,
      fileName: file.name,
      fileType: EMBED_FILE_TYPE,
      fileSize: 0,
      kind: "video",
    };
  }

  if (mime.startsWith("audio/")) {
    return {
      filePath: `https://drive.google.com/file/d/${file.id}/preview`,
      fileName: file.name,
      fileType: AUDIO_EMBED_FILE_TYPE,
      fileSize: 0,
      kind: "audio",
    };
  }

  return {
    filePath: driveViewUrl(file.id, mime),
    fileName: file.name,
    fileType: DRIVE_LINK_FILE_TYPE,
    fileSize: file.size ?? 0,
    kind: "document",
  };
}
