/**
 * Sends a file to /api/media/upload and returns its public URL.
 *
 * The upload route takes base64 in a JSON body rather than multipart, so the
 * read-and-encode dance is here rather than repeated at each call site.
 */
export async function uploadImage(file: File): Promise<string> {
  const reader = new FileReader();
  const result = await new Promise<string | ArrayBuffer | null>((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  if (!result || typeof result !== "string") {
    throw new Error("Unable to read that file");
  }

  const response = await fetch("/api/media/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      data: result.split(",")[1],
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error || "Upload failed");
  }

  return String(json.url || "");
}

/** Guard shared by every avatar picker in the app. */
export function validateImageFile(file: File, maxBytes = 5 * 1024 * 1024): string | null {
  if (!file.type.startsWith("image/")) return "Please choose an image file.";
  if (file.size > maxBytes) return `Images must be under ${Math.round(maxBytes / 1024 / 1024)}MB.`;
  return null;
}
