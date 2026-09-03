/**
 * Browser-side: get a Work Drive file from a picker into the bucket and
 * recorded, in one call. No server imports — this runs in the client bundle.
 *
 *   presign  -> signed PUT (or `proxy` on a laptop with no bucket)
 *   PUT      -> bytes straight to storage, bypassing the 4.5 MB body cap
 *   register -> POST the metadata so a DriveFile row exists
 *
 * A signed URL that is never followed by a register call leaves nothing
 * behind, so a failure halfway is safe to retry.
 */

export type WorkDriveUploadResult = {
  id: string;
  name: string;
  kind: string;
  sizeBytes: number;
};

export async function uploadWorkDriveFile(
  file: File,
  opts: { workspaceSlug: string; folderId?: string | null },
): Promise<WorkDriveUploadResult> {
  const contentType = file.type || guessType(file.name);

  const presignRes = await fetch("/api/admin/work-drive/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType, size: file.size }),
  });
  const presign = await presignRes.json().catch(() => null);
  if (!presignRes.ok) {
    throw new Error(presign?.error || `Upload could not start (${presignRes.status}).`);
  }

  let storageKey: string | undefined = presign.key;
  let url: string | undefined = presign.url;

  if (presign.mode === "direct") {
    const put = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
    if (!put.ok) {
      const text = await put.text().catch(() => "");
      throw new Error(`Direct upload failed (${put.status}). ${text || "Check the bucket's CORS rules."}`);
    }
  } else {
    // proxy mode: post the bytes through the app as base64 (local dev only,
    // when no bucket is configured). Same contract as src/lib/upload.ts.
    const proxied = await fetch("/api/media/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType,
        folder: "work-drive",
        data: await readAsBase64(file),
      }),
    });
    const json = await proxied.json().catch(() => null);
    if (!proxied.ok) throw new Error(json?.error || "Upload failed.");
    url = json.url;
    storageKey = undefined;
  }

  const registerRes = await fetch("/api/admin/work-drive/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceSlug: opts.workspaceSlug,
      folderId: opts.folderId ?? null,
      name: file.name,
      storageKey,
      url,
      mimeType: contentType,
      size: file.size,
    }),
  });
  const registered = await registerRes.json().catch(() => null);
  if (!registerRes.ok) {
    throw new Error(registered?.error || "The file uploaded but could not be saved.");
  }
  return registered.file as WorkDriveUploadResult;
}

async function readAsBase64(file: File): Promise<string> {
  const reader = new FileReader();
  const result = await new Promise<string | ArrayBuffer | null>((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  if (!result || typeof result !== "string") throw new Error("Could not read that file.");
  return result.split(",")[1];
}

/** A last-resort MIME guess when the OS handed the picker a blank type. */
function guessType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    csv: "text/csv",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    zip: "application/zip",
  };
  return map[ext] || "application/octet-stream";
}
