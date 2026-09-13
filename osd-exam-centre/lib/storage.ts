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

  const publicBase = process.env.S3_PUBLIC_BASE_URL;
  const url = publicBase ? `${publicBase.replace(/\/$/, "")}/${key}` : `${process.env.S3_ENDPOINT}/${bucket}/${key}`;
  return { url, key };
}

function guessExtension(contentType: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("heic") || contentType.includes("heif")) return ".heic";
  if (contentType.includes("pdf")) return ".pdf";
  return ".jpg";
}
