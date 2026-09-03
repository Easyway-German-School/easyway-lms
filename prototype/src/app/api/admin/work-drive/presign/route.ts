import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { normalizeStorageEndpoint, objectStorage, publicUrlFor, storageKey } from "@/lib/storage";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { ALLOWED_CONTENT_TYPES, MAX_FILE_BYTES, WORK_DRIVE_PREFIX } from "@/lib/work-drive/files";
import { workDriveConfig } from "@/lib/work-drive/settings";

export const dynamic = "force-dynamic";

/**
 * A signed PUT for one Work Drive file.
 *
 * The same shape as /api/media/presign — the bytes go straight to the bucket,
 * never through the app, because Vercel caps a request body at 4.5 MB and a
 * scanned contract or a training video is bigger than that. What differs:
 *
 *  - it is gated on the `work_drive` capability, not just a session;
 *  - the allowlist is the office-document set in lib/work-drive/files.ts, not
 *    the narrower media set;
 *  - the key lands under `work-drive/`, which `storageForKey` routes to the
 *    private bucket, so nothing here is world-readable and downloads go back
 *    through a capability-checked route.
 *
 * When no bucket is configured (a laptop) this answers `mode: "proxy"` and the
 * client falls back to /api/media/upload, same as everywhere else.
 */

/** Ten minutes: long enough for a big file on a bad line, short enough to matter. */
const EXPIRY_SECONDS = 600;

export async function POST(request: NextRequest) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const limit = checkRateLimit(`work-drive:presign:${gate.admin.userId}`, {
    windowMs: 60 * 60 * 1000,
    max: 300,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit, "Too many uploads in a short time. Please pause a moment.");
  }

  const body = await request.json().catch(() => ({}));
  const filename = String(body.filename ?? "").trim();
  const contentType = String(body.contentType ?? "").toLowerCase().split(";")[0].trim();
  const size = Number(body.size ?? 0);

  if (!filename) {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: `Files of type "${contentType || "unknown"}" can't be uploaded here yet.` },
      { status: 415 },
    );
  }
  if (Number.isFinite(size) && size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `That file is over the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB limit.` },
      { status: 413 },
    );
  }

  /**
   * Storage quota. A soft check at presign time — a burst of concurrent
   * uploads can still nudge slightly over, which the doc accepts for v1; the
   * point is that a tenant near the ceiling is stopped, not that the ceiling
   * is exact to the byte.
   */
  const tenantId = gate.session.user.tenantId ?? null;
  if (tenantId && Number.isFinite(size) && size > 0) {
    const { quotaBytes } = await workDriveConfig(tenantId);
    const agg = await prisma.workspace.aggregate({
      where: { deletedAt: null },
      _sum: { storageUsedBytes: true },
    });
    const used = Number(agg._sum.storageUsedBytes ?? 0);
    if (used + size > quotaBytes) {
      return NextResponse.json(
        {
          error: `The Work Drive is at its storage limit (${(quotaBytes / 1024 ** 3).toFixed(0)} GB). Delete some files or ask an admin to raise the limit.`,
        },
        { status: 507 },
      );
    }
  }

  const storage = objectStorage();
  if (!storage) {
    // No bucket — local dev. The client posts the file to /api/media/upload.
    return NextResponse.json({ mode: "proxy" });
  }

  const key = storageKey(WORK_DRIVE_PREFIX, filename);
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
    aws: { signQuery: true },
  });

  return NextResponse.json({
    mode: "direct",
    uploadUrl: signed.url,
    key,
    contentType,
    // The app-served URL for the key; the download route re-checks capability.
    url: publicUrlFor(key, storage),
  });
}
