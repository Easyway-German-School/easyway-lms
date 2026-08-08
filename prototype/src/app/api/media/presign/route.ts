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

export const dynamic = "force-dynamic";

/** Ten minutes: long enough for a big file on a bad line, short enough to matter. */
const EXPIRY_SECONDS = 600;

const FOLDERS = new Set(["files", "materials", "photos"]);

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
  if (!session?.user?.id && folder !== "photos") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
