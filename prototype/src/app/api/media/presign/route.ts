/**
 * Hands the browser a short-lived URL it can PUT a file straight into the
 * bucket with.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT JUST POST THE FILE TO US
 * ---------------------------------------------------------------------------
 * Because on Vercel the request body is capped at 4.5 MB, and a tutor's lesson
 * PDF or a recorded class is routinely larger than that. Uploading through the
 * app would work on a laptop and fail in production on exactly the files the
 * feature exists for — and it would fail at the end of the upload, after the
 * tutor has waited.
 *
 * So the bytes never touch the app. We sign a PUT, the browser sends the file
 * to the bucket directly, and then posts us the metadata. This also means a
 * 200 MB upload does not occupy a serverless function for its duration.
 *
 * The signature is scoped to one key and expires in ten minutes, so what the
 * caller receives is permission to write one file, not access to the bucket.
 *
 * When no bucket is configured — a fresh clone, a laptop — this answers
 * `mode: "proxy"` and the client falls back to posting the file to
 * /api/media/upload, which writes to public/uploads. Local development needs no
 * cloud account.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { normalizeStorageEndpoint, objectStorage, publicUrlFor, storageKey } from "@/lib/storage";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Ten minutes: long enough for a big file on a bad line, short enough to matter. */
const EXPIRY_SECONDS = 600;

const FOLDERS = new Set(["files", "materials", "photos"]);

/**
 * What an ANONYMOUS caller may be handed a signed PUT for.
 *
 * The `photos` folder is deliberately open — a student uploads their portrait
 * during signup, before the account they would authenticate with exists. That
 * trade-off is sound, but it was unbounded in two ways that together made this
 * the softest endpoint in the app: any content type, and no rate limit. An
 * anonymous caller could mint unlimited signed URLs and PUT arbitrary bytes
 * into the school's bucket — a storage bill with no ceiling, and a file store
 * that would happily hold whatever anyone chose to leave in it.
 *
 * Images only, therefore, and only the three formats a camera or a phone
 * gallery actually produces. `STORAGE_PUBLIC_BASE_URL` is intentionally empty
 * so nothing in the bucket is world-readable, which is what keeps this a
 * storage-abuse problem rather than a malware-hosting one — but relying on
 * that alone would be relying on one env var never being filled in.
 */
const ANONYMOUS_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * And what a signed-in caller may. Wider, because tutors upload teaching
 * material, but still a list rather than "anything": an allowlist that grows
 * by request is the only kind that stays meaningful.
 */
const AUTHENTICATED_CONTENT_TYPES = new Set([
  ...ANONYMOUS_CONTENT_TYPES,
  "image/gif",
  "image/heic",
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export async function POST(request: NextRequest) {
  // Parse the body early so callers that want to upload signup photos
  // (folder: "photos") can be allowed without an authenticated session.
  const body = await request.json().catch(() => ({}));
  const filename = String(body.filename ?? "").trim();
  const contentType = String(body.contentType ?? "application/octet-stream");
  // The folder is chosen from a fixed set rather than taken from the caller, so
  // a signed URL can never be aimed at the recordings prefix.
  const folder = FOLDERS.has(String(body.folder)) ? String(body.folder) : "files";

  if (!filename) {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }

  // Allow unauthenticated uploads to the `photos` folder so signup can upload
  // an avatar before the user has an account. All other folders still require
  // an authenticated session.
  const session = await requireAuthSession();
  const signedIn = Boolean(session?.user?.id);
  if (!signedIn && folder !== "photos") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /**
   * Metered before anything is signed.
   *
   * Keyed by account when there is one and by IP when there is not, because
   * the anonymous signup path is the one that needs the brake most. Six is
   * comfortably above the real case — a student retaking their portrait a few
   * times — and far below anything that could run up a storage bill.
   */
  const limit = checkRateLimit(
    signedIn ? `presign:user:${session!.user.id}` : `presign:ip:${clientIp(request.headers)}`,
    signedIn ? { windowMs: 60 * 60 * 1000, max: 120 } : { windowMs: 60 * 60 * 1000, max: 6 },
  );
  if (!limit.ok) {
    return rateLimitResponse(limit, "Too many uploads from this connection. Please try again shortly.");
  }

  // The signature commits to this Content-Type, so the browser cannot swap it
  // afterwards — checking it here is therefore a real constraint on the bytes
  // that can land, not merely on what the caller claims.
  const allowed = signedIn ? AUTHENTICATED_CONTENT_TYPES : ANONYMOUS_CONTENT_TYPES;
  if (!allowed.has(contentType.toLowerCase().split(";")[0].trim())) {
    return NextResponse.json(
      {
        error: signedIn
          ? "That file type is not accepted."
          : "Please upload a photo — JPEG, PNG or WebP.",
      },
      { status: 415 },
    );
  }

  const storage = objectStorage();
  if (!storage) {
    return NextResponse.json({ mode: "proxy" });
  }

  const key = storageKey(folder, filename);
  const endpoint = normalizeStorageEndpoint(storage.endpoint);
  const base = endpoint
    ? `${endpoint.replace(/\/+$/, "")}/${storage.bucket}`
    : `https://${storage.bucket}.s3.${storage.region}.amazonaws.com`;

  const { AwsClient } = await import("aws4fetch");
  const aws = new AwsClient({
    accessKeyId: storage.accessKey,
    secretAccessKey: storage.secret,
    region: storage.region,
    service: "s3",
  });

  const signed = await aws.sign(`${base}/${key}?X-Amz-Expires=${EXPIRY_SECONDS}`, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    // Puts the signature in the query string, so the browser only has to send
    // the file — no Authorization header to reproduce, and no preflight beyond
    // the one the bucket's CORS rule already has to allow.
    aws: { signQuery: true },
  });

  return NextResponse.json({
    mode: "direct",
    uploadUrl: signed.url,
    key,
    url: publicUrlFor(key, storage),
    contentType,
  });
}
