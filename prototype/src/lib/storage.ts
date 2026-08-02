/**
 * Where uploaded files live.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Every upload route used to write into `public/uploads` and hand back the
 * path. That works on a laptop and is silently catastrophic on Vercel: the
 * filesystem there is read-only apart from /tmp, and /tmp belongs to one
 * invocation. A student's passport scan would either throw EROFS or appear to
 * upload and be gone by the next request — and "gone by the next request" is
 * the worse of the two, because nobody finds out until somebody looks for it.
 *
 * So files go to an object bucket in production. Any S3-compatible one:
 * Cloudflare R2, Backblaze B2, AWS S3, MinIO. The same bucket the class
 * recordings use — `RECORDING_S3_*` is read as a fallback precisely so a school
 * that has already set those up does not need a second set of credentials.
 *
 * ---------------------------------------------------------------------------
 * WHY FILES ARE SERVED THROUGH THE APP BY DEFAULT
 * ---------------------------------------------------------------------------
 * These uploads are not marketing images. They are student photographs and
 * ID/passport scans. Left in a public bucket they are readable by anybody who
 * can guess `<timestamp>-passport.jpg`, which is not much of a guess.
 *
 * So unless `STORAGE_PUBLIC_BASE_URL` is set, a stored file's URL points at
 * `/api/files/<key>` — this app, behind the session check — and the route
 * fetches it from the bucket with a signed request. Set the public base URL
 * only for a bucket you are content to have world-readable.
 *
 * Class recordings are the deliberate exception: they are large, they are
 * streamed, and they carry no personal documents, so they keep using
 * `RECORDING_PUBLIC_BASE_URL` and a CDN. See lib/recording.ts.
 */

import { existsSync, mkdirSync } from "fs";
import { writeFile, unlink } from "fs/promises";
import path from "path";

export type ObjectStorage = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKey: string;
  secret: string;
  publicBaseUrl?: string;
};

/**
 * Credentials for the upload bucket.
 *
 * `STORAGE_S3_*` wins; `RECORDING_S3_*` is honoured as a fallback so one bucket
 * and one key pair can serve both, which is what most schools will want.
 */
export function objectStorage(): ObjectStorage | null {
  const bucket = process.env.STORAGE_S3_BUCKET || process.env.RECORDING_S3_BUCKET;
  const accessKey = process.env.STORAGE_S3_ACCESS_KEY || process.env.RECORDING_S3_ACCESS_KEY;
  const secret = process.env.STORAGE_S3_SECRET || process.env.RECORDING_S3_SECRET;
  if (!bucket || !accessKey || !secret) return null;

  return {
    bucket,
    // R2 ignores region, but SigV4 requires one and "auto" is what R2 documents.
    region: process.env.STORAGE_S3_REGION || process.env.RECORDING_S3_REGION || "auto",
    endpoint: process.env.STORAGE_S3_ENDPOINT || process.env.RECORDING_S3_ENDPOINT || undefined,
    accessKey,
    secret,
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL || undefined,
  };
}

export function storageConfigured(): boolean {
  return objectStorage() !== null;
}

/** The bucket's own address for an object, used for signing. */
function objectUrl(key: string, storage: ObjectStorage): string {
  const base = storage.endpoint
    ? `${storage.endpoint.replace(/\/+$/, "")}/${storage.bucket}`
    : `https://${storage.bucket}.s3.${storage.region}.amazonaws.com`;
  return `${base}/${key.replace(/^\/+/, "")}`;
}

async function signer(storage: ObjectStorage) {
  const { AwsClient } = await import("aws4fetch");
  return new AwsClient({
    accessKeyId: storage.accessKey,
    secretAccessKey: storage.secret,
    region: storage.region,
    service: "s3",
  });
}

/**
 * A filename that cannot escape its folder or collide with last week's upload.
 *
 * The timestamp alone was not enough — two people uploading in the same
 * millisecond is unlikely, but two people uploading `photo.jpg` is not, and the
 * old scheme let the second overwrite the first.
 */
export function storageKey(folder: string, filename: string): string {
  const safe = String(filename)
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/^\.+/, "")
    .slice(-120) || "file";
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cleanFolder = folder.replace(/^\/+|\/+$/g, "");
  return `${cleanFolder}/${unique}-${safe}`;
}

/**
 * Store a file and return the URL to save in the database.
 *
 * In development with no bucket configured this still writes to
 * `public/uploads`, so a fresh clone works with no accounts to sign up for. In
 * production it refuses rather than pretending: an upload that returns 200 and
 * loses the file is worse than one that fails loudly.
 */
export async function putFile(input: {
  key: string;
  body: Buffer;
  contentType?: string;
}): Promise<string> {
  const storage = objectStorage();

  if (!storage) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "No file storage is configured. Set STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY and STORAGE_S3_SECRET.",
      );
    }
    const target = path.join(process.cwd(), "public", "uploads", input.key);
    mkdirSync(path.dirname(target), { recursive: true });
    await writeFile(target, input.body);
    return `/uploads/${input.key}`;
  }

  const aws = await signer(storage);
  const response = await aws.fetch(objectUrl(input.key, storage), {
    method: "PUT",
    body: new Uint8Array(input.body),
    headers: {
      "Content-Type": input.contentType || "application/octet-stream",
      "Content-Length": String(input.body.length),
    },
  });

  if (!response.ok) {
    throw new Error(`Upload to storage failed (${response.status})`);
  }

  return publicUrlFor(input.key, storage);
}

/**
 * What the browser should request for a stored key.
 *
 * Without an explicit public base this is `/api/files/<key>` — served by this
 * app, behind the session check. See the note at the top of the file.
 */
export function publicUrlFor(key: string, storage = objectStorage()): string {
  const clean = key.replace(/^\/+/, "");
  if (storage?.publicBaseUrl) {
    return `${storage.publicBaseUrl.replace(/\/+$/, "")}/${clean}`;
  }
  if (storage) return `/api/files/${clean}`;
  return `/uploads/${clean}`;
}

/**
 * Recover the object key from a URL we previously handed out, so deletes can
 * find the file again. Returns null for anything that did not come from us.
 */
export function keyFromUrl(url: string | null | undefined): string | null {
  const value = String(url ?? "").trim();
  if (!value) return null;

  if (value.startsWith("/api/files/")) return value.slice("/api/files/".length);
  if (value.startsWith("/uploads/")) return value.slice("/uploads/".length);

  const storage = objectStorage();
  if (storage?.publicBaseUrl && value.startsWith(storage.publicBaseUrl)) {
    return value.slice(storage.publicBaseUrl.replace(/\/+$/, "").length + 1);
  }
  if (storage?.endpoint && value.startsWith(storage.endpoint)) {
    const prefix = `${storage.endpoint.replace(/\/+$/, "")}/${storage.bucket}/`;
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return null;
}

/**
 * Fetch an object out of the bucket, for the /api/files route to stream on.
 *
 * `range` is forwarded untouched so a video can be scrubbed: without it the
 * player has to download the whole file before it can seek, which on a phone
 * on mobile data is the difference between usable and not.
 */
export async function getFile(key: string, range?: string | null): Promise<Response | null> {
  const storage = objectStorage();
  if (!storage) return null;

  const aws = await signer(storage);
  const response = await aws.fetch(objectUrl(key, storage), {
    method: "GET",
    headers: range ? { Range: range } : undefined,
  });
  // 206 is the successful answer to a range request, and `ok` does not cover it.
  return response.ok || response.status === 206 ? response : null;
}

/**
 * Remove a stored file. Returns false rather than throwing, because a delete
 * that cannot reach the bucket must not stop the database row going away —
 * an orphaned object costs pennies, a row that will not delete blocks the user.
 */
export async function deleteFile(key: string): Promise<boolean> {
  const storage = objectStorage();

  if (!storage) {
    try {
      const target = path.join(process.cwd(), "public", "uploads", key);
      if (existsSync(target)) await unlink(target);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const aws = await signer(storage);
    const response = await aws.fetch(objectUrl(key, storage), { method: "DELETE" });
    // 204 for a delete, 404 for one that was already gone — both are the
    // outcome the caller wanted.
    return response.status === 204 || response.status === 200 || response.status === 404;
  } catch (error) {
    console.error(`Could not delete ${key}:`, error);
    return false;
  }
}
