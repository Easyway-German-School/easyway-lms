/**
 * The one way a file gets from a browser into storage.
 *
 * Callers do not need to know whether the school has an object bucket. This
 * asks /api/media/presign, and then either sends the file straight to the
 * bucket (production, no size limit worth worrying about) or posts it through
 * /api/media/upload to land on disk (a laptop with no cloud account). Either
 * way it returns the URL to store on the row.
 *
 * The direct path matters more than it looks: Vercel caps a request body at
 * 4.5 MB, so anything that goes through the app fails on a real lesson PDF or
 * a recorded class — and fails at the end of the wait, which is the worst
 * moment to find out.
 */

export type UploadedFile = {
  url: string;
  filename: string;
  contentType: string;
  size: number;
};

/** Which prefix the file lands under. Must be one the presign route allows. */
export type UploadFolder = "files" | "materials" | "photos";

async function readAsBase64(file: File): Promise<string> {
  const reader = new FileReader();
  const result = await new Promise<string | ArrayBuffer | null>((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  if (!result || typeof result !== "string") {
    throw new Error("Unable to read that file");
  }
  return result.split(",")[1];
}

export async function uploadFile(file: File, folder: UploadFolder = "files"): Promise<UploadedFile> {
  const contentType = file.type || "application/octet-stream";

  const presign = await fetch("/api/media/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType, folder }),
  });

  const presignText = await presign.text().catch(() => "");
  let presignJson: any = null;
  try {
    presignJson = presignText ? JSON.parse(presignText) : null;
  } catch {
    presignJson = null;
  }

  if (!presign.ok) {
    const reason =
      (presignJson?.error && String(presignJson.error)) || presignText || "Upload failed";
    throw new Error(reason);
  }

  const plan = presignJson;

  async function proxyUpload() {
    const response = await fetch("/api/media/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType,
        folder,
        data: await readAsBase64(file),
      }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = (json?.error && String(json.error)) || `Upload failed (${response.status})`;
      throw new Error(reason);
    }

    return {
      url: String(json.url || ""),
      filename: file.name,
      contentType,
      size: Number(json.size) || file.size,
    };
  }

  if (plan.mode === "direct") {
    try {
      const put = await fetch(plan.uploadUrl, {
        method: "PUT",
        // Must match the Content-Type that was signed, or the bucket rejects the
        // signature — a mismatch here is the classic cause of a 403 on upload.
        headers: { "Content-Type": contentType },
        body: file,
      });

      if (!put.ok) {
        const statusText = await put.text().catch(() => "");
        throw new Error(
          `Direct upload failed (${put.status}). ${
            statusText || "Check the bucket's CORS rules allow PUT from this site."
          }`,
        );
      }

      return { url: String(plan.url), filename: file.name, contentType, size: file.size };
    } catch (directUploadError) {
      console.warn("Direct upload failed, falling back to proxy upload:", directUploadError);
      return proxyUpload();
    }
  }

  return proxyUpload();
}

/** Every avatar picker in the app. Kept for the call sites that only want a URL. */
export async function uploadImage(file: File): Promise<string> {
  const uploaded = await uploadFile(file, "photos");
  return uploaded.url;
}

/** Guard shared by every avatar picker in the app. */
export function validateImageFile(file: File, maxBytes = 5 * 1024 * 1024): string | null {
  if (!file.type.startsWith("image/")) return "Please choose an image file.";
  if (file.size > maxBytes) return `Images must be under ${Math.round(maxBytes / 1024 / 1024)}MB.`;
  return null;
}
