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

  if (!presign.ok) {
    const json = await presign.json().catch(() => ({}));
    throw new Error(json?.error || "Upload failed");
  }

  const plan = await presign.json();

  if (plan.mode === "direct") {
    const put = await fetch(plan.uploadUrl, {
      method: "PUT",
      // Must match the Content-Type that was signed, or the bucket rejects the
      // signature — a mismatch here is the classic cause of a 403 on upload.
      headers: { "Content-Type": contentType },
      body: file,
    });

    if (!put.ok) {
      throw new Error(`Upload failed (${put.status}). Check the bucket's CORS rules allow PUT from this site.`);
    }

    return { url: String(plan.url), filename: file.name, contentType, size: file.size };
  }

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

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error || "Upload failed");
  }

  return {
    // The original name, not the uniquified one the server stored under —
    // this is what gets shown to students in the materials list.
    url: String(json.url || ""),
    filename: file.name,
    contentType,
    size: Number(json.size) || file.size,
  };
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
