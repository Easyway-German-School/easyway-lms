import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Where an uploaded file (passport photo, passport data page, payment slip)
 * actually lands.
 *
 * Two modes, chosen by whether S3_* env vars are set:
 *  - Local disk, under public/uploads/ — fine for local dev, but Vercel's
 *    deployed filesystem is read-only outside /tmp, so this silently stops
 *    persisting anything the moment this app is deployed there without real
 *    object-storage credentials. That's a deliberate placeholder, not a bug:
 *    see README.md. Wire up R2/S3 credentials before taking real uploads in
 *    production.
 *  - An S3-compatible bucket (Cloudflare R2, AWS S3, …) via @aws-sdk/client-s3.
 *
 * Either way the caller gets back one thing: a URL it can store on the row
 * and show back to the candidate/admin.
 */

export type StoredFile = { url: string; key: string };

function s3Configured(): boolean {
  return Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
}

export async function storeUpload(buffer: Buffer, opts: { folder: string; filename: string; contentType: string }): Promise<StoredFile> {
  // The extension comes from the (now server-validated — see
  // app/api/upload/route.ts) content type, never from the client-supplied
  // filename. Trusting the filename's extension would let someone upload
  // content typed "image/jpeg" but named "whatever.exe" and have it land in
  // the bucket with a .exe extension — a content-type/extension mismatch
  // that serves no purpose except confusing whatever opens it later.
  const ext = guessExtension(opts.contentType);
  const key = `${opts.folder}/${randomUUID()}${ext}`;

  if (s3Configured()) {
    return storeToS3(buffer, key, opts.contentType);
  }
  return storeToDisk(buffer, key);
}

async function storeToDisk(buffer: Buffer, key: string): Promise<StoredFile> {
  const filePath = path.join(process.cwd(), "public", "uploads", key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return { url: `/uploads/${key}`, key };
}

async function storeToS3(buffer: Buffer, key: string, contentType: string): Promise<StoredFile> {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT, // set for R2; omit for real AWS S3
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  const bucket = process.env.S3_BUCKET!;
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }));

  // No S3_PUBLIC_BASE_URL set: default to a private bucket served through
  // this app's own admin-gated proxy (/api/files/<key> — see
  // app/api/files/[...key]/route.ts) rather than a raw bucket URL. These are
  // passport photos and bank-transfer slips; a public (even "unlisted") URL
  // to one is a standing leak the moment it appears in an email, a browser
  // history, or a log line. Set S3_PUBLIC_BASE_URL explicitly (an R2 custom
  // domain, a CDN) only if the bucket is deliberately public.
  const publicBase = process.env.S3_PUBLIC_BASE_URL;
  const url = publicBase ? `${publicBase.replace(/\/$/, "")}/${key}` : `/api/files/${key}`;
  return { url, key };
}

export type ReadFile = { buffer: Buffer; contentType: string };

/** Reads a file back from the S3-compatible bucket — used by the admin-only proxy route, never called directly with a client-supplied path. */
export async function readUpload(key: string): Promise<ReadFile | null> {
  if (!s3Configured()) return null;
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
    const buffer = Buffer.from(await result.Body!.transformToByteArray());
    return { buffer, contentType: result.ContentType || "application/octet-stream" };
  } catch {
    return null;
  }
}

function guessExtension(contentType: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("heic") || contentType.includes("heif")) return ".heic";
  if (contentType.includes("pdf")) return ".pdf";
  return ".jpg";
}
