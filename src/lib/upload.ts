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

type Heic2Any = (options: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>;

/**
 * iPhones default to saving photos as HEIC/HEIF, which almost nothing outside
 * Apple's own software can decode — a HEIC avatar renders as an empty circle
 * on Android, on Windows, in Chrome and Firefox everywhere. Converted here,
 * once, before the bytes go anywhere, so every one of the dozen pickers that
 * call `uploadFile` gets the fix without knowing it happened.
 *
 * A blank `file.type` with a `.heic`/`.heif` name covers Android and some
 * older Safari builds, which hand the browser a photo with no MIME type at
 * all rather than a wrong one.
 */
async function convertHeicIfNeeded(file: File): Promise<File> {
  const looksHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    (!file.type && /\.(heic|heif)$/i.test(file.name));
  if (!looksHeic) return file;

  try {
    const heic2any = ((await import("heic2any")).default as unknown) as Heic2Any;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const name = file.name.replace(/\.(heic|heif)$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    throw new Error("This photo format can't be processed automatically — please choose a JPG or PNG.");
  }
}

/**
 * Shrink a camera photo in the browser BEFORE it is uploaded.
 *
 * A modern phone camera writes an 8–15 MB JPEG (or HEIC). Sending that whole
 * file over a Nigerian mobile connection is a 20–40 second upload — long enough
 * that the OS reclaims the `File` handle mid-transfer (see `uploadFile`), the
 * student switches apps, or the tab is backgrounded, and the upload fails at
 * the end of the wait. An avatar is displayed at ~130 px; 1600 px on the long
 * edge at JPEG 0.82 is indistinguishable and lands in well under a second.
 *
 * Rules that keep this from ever making an upload WORSE:
 *  - Only touches raster photos. SVG and GIF are passed straight through.
 *  - EXIF orientation is honoured (`imageOrientation: "from-image"`), so a
 *    portrait selfie is not saved on its side.
 *  - The re-encoded blob is used ONLY if it is actually smaller.
 *  - ANY failure — a browser without `createImageBitmap`, a decode error, a
 *    null `toBlob` — returns the original file untouched. Compression is an
 *    optimisation, never a gate.
 */
async function downscaleImage(file: File, maxDim?: number, quality = 0.82): Promise<File> {
  const type = file.type.toLowerCase();
  const isRaster =
    type === "image/jpeg" || type === "image/png" || type === "image/webp" || type === "image/heic" || type === "image/heif";
  if (!isRaster) return file;
  // Nothing to gain on a file that is already small and web-sized.
  if (file.size <= 512 * 1024) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  // A phone that reports 2 GB or less of RAM is the one that throws mid-resize
  // and surfaces the browser's own "low memory" — give it a smaller target so
  // the canvas it has to allocate is a quarter of the size.
  const deviceMemory =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined;
  const targetDim = maxDim ?? (typeof deviceMemory === "number" && deviceMemory <= 2 ? 1000 : 1400);

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, targetDim / longest);
    // Already within bounds AND not a heavy PNG worth transcoding — leave it.
    if (scale === 1 && file.size <= 1.5 * 1024 * 1024) {
      bitmap.close?.();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.(jpe?g|png|webp|heic|heif)$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

async function readAsBase64(blob: Blob): Promise<string> {
  const reader = new FileReader();
  const result = await new Promise<string | ArrayBuffer | null>((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  if (!result || typeof result !== "string") {
    throw new Error("Unable to read that file");
  }
  return result.split(",")[1];
}

export async function uploadFile(rawFile: File, folder: UploadFolder = "files"): Promise<UploadedFile> {
  const converted = await convertHeicIfNeeded(rawFile);
  // Photos (avatars) are downscaled in the browser first — see `downscaleImage`.
  // Materials and documents are left exactly as the office picked them.
  const file = folder === "photos" ? await downscaleImage(converted) : converted;
  const contentType = file.type || "application/octet-stream";

  // Snapshot the bytes into memory NOW, before the presign round-trip below.
  //
  // A `File` is a live handle to something the OS still owns, and phones revoke
  // it out from under us: iOS when Safari is backgrounded or the photo is still
  // syncing from iCloud, Android when the picker app is killed and its
  // `content://` URI is dropped. That revocation almost always lands during the
  // network hop for the presign — so the read that follows throws
  // `NotReadableError` and the upload dies at the very end of the wait, which
  // is the one moment it must not. A `Blob` we already hold cannot be revoked.
  //
  // Capped so a large materials or class-recording upload isn't buffered whole;
  // those go from a laptop and don't hit the mobile handle-revocation race.
  let body: Blob = file;
  if (file.size <= 25 * 1024 * 1024) {
    try {
      body = new Blob([await file.arrayBuffer()], { type: contentType });
    } catch {
      throw new DOMException(
        "Your device released that photo before it could be read. Please select it again.",
        "NotReadableError",
      );
    }
  }

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
        data: await readAsBase64(body),
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
        body,
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

/**
 * Turn an upload failure into a sentence the person can act on.
 *
 * A `File` is a handle to something the OS owns, not the bytes themselves, and
 * phones invalidate that handle: iOS when the photo is still in iCloud or
 * Safari gets backgrounded, Android when the picker app is killed and its
 * `content://` URI is revoked. The browser then throws `NotReadableError`,
 * whose own message — "typically due to permission problems that have occurred
 * after a reference to a file was acquired" — means nothing to somebody halfway
 * through signing up, and reads like the site is broken rather than like the
 * photo needs picking again.
 */
export function uploadErrorMessage(error: unknown, fallback = "Upload failed"): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotReadableError" || name === "NotFoundError") {
    return "Your device released that photo before it finished uploading. Please select it again.";
  }
  // A cheap phone decoding a big camera photo can exhaust its memory — the
  // browser throws a RangeError or an out-of-memory DOMException, and the
  // person just sees "low memory". Say what actually helps.
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : "";
  if (
    error instanceof RangeError ||
    /out of memory|low memory|memory|allocation failed|array buffer allocation/i.test(raw)
  ) {
    return "Your phone ran low on memory handling that photo. Close other apps and browser tabs, then try again — or ask the office to add it for you.";
  }
  return error instanceof Error ? error.message : fallback;
}

/**
 * Guard shared by every avatar picker in the app.
 *
 * The ceiling is 16MB, not 5MB: a modern phone camera writes 8–15MB files and
 * `downscaleImage` (in `uploadFile`) shrinks a photo to a few hundred KB before
 * it is sent, so rejecting the raw pick would turn away photos that upload
 * perfectly well. A blank `file.type` with a `.heic`/`.heif` name is allowed
 * through — Android and some Safari builds report no MIME type for HEIC, and
 * `convertHeicIfNeeded` handles it downstream.
 */
export function validateImageFile(file: File, maxBytes = 16 * 1024 * 1024): string | null {
  const looksHeic = !file.type && /\.(heic|heif)$/i.test(file.name);
  if (!file.type.startsWith("image/") && !looksHeic) return "Please choose an image file.";
  if (file.size > maxBytes) return `Images must be under ${Math.round(maxBytes / 1024 / 1024)}MB.`;
  return null;
}
