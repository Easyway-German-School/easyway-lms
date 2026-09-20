import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { getFile, signedGetUrl, storageConfigured } from "@/lib/storage";
import { fileAccessFor } from "@/lib/work-drive/workspaces";
import { logFileActivity, WORK_DRIVE_PREFIX } from "@/lib/work-drive/files";

export const dynamic = "force-dynamic";

/**
 * Serves a Work Drive file out of the private bucket.
 *
 * Unlike /api/files, this checks the `work_drive` capability AND that the
 * caller can see the workspace the file lives in — a student who guessed the
 * object key gets a 403, not the school's finance spreadsheet.
 *
 * `?inline=1` serves it for viewing in the browser (a PDF, an image); the
 * default is `attachment`, i.e. download.
 *
 * egress-reviewed: after those checks the caller is redirected to a
 * ten-minute signed bucket URL that carries the real filename, so the file's
 * bytes do not pass through this function (Vercel bills every proxied byte as
 * Fast Origin Transfer). The streaming code below is only the fallback for a
 * bucket that cannot sign.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const file = await prisma.driveFile.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      mimeType: true,
      storageKey: true,
      workspace: {
        select: {
          id: true,
          visibility: true,
          branchId: true,
          createdById: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await fileAccessFor(file, gate.admin)).canView) {
    return NextResponse.json({ error: "Not your file." }, { status: 403 });
  }

  const key = file.storageKey.replace(/^\/+/, "");
  if (!key.startsWith(`${WORK_DRIVE_PREFIX}/`) || key.includes("..")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!storageConfigured()) {
    // Local dev: the file is on disk under /uploads and Next serves it there.
    return NextResponse.redirect(new URL(`/uploads/${key}`, request.url));
  }

  const inline = new URL(request.url).searchParams.get("inline") === "1";
  // The quoted name must be plain printable ASCII; the real name (accents and
  // all) travels in the `filename*` part of the signed link below.
  const safeName = file.name.replace(/["\\\r\n]|[^\x20-\x7E]/g, "_");
  const disposition = `${inline ? "inline" : "attachment"}; filename="${safeName}"`;

  // Only bill the activity feed for a real (non-range) fetch — a video scrub
  // fires dozens of range requests and none of them is "someone downloaded it".
  const recordDownload = async () => {
    if (request.headers.get("range")) return;
    await logFileActivity({
      workspaceId: file.workspace.id,
      actorId: gate.admin.userId,
      action: "downloaded",
      fileId: file.id,
      meta: { name: file.name },
    });
  };

  // Permission has been checked above. Hand the browser a short-lived link to
  // the bucket instead of carrying the bytes ourselves. The filename and type
  // are signed into the link so the download keeps its real name.
  const signed = await signedGetUrl(key, 600, {
    contentDisposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    contentType: file.mimeType || "application/octet-stream",
  });
  if (signed) {
    await recordDownload();
    const redirect = NextResponse.redirect(signed, 302);
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }

  // Fallback: the bucket could not sign, so stream it as before.
  const upstream = await getFile(key, request.headers.get("range"));
  if (!upstream || !upstream.body) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const headers = new Headers();
  for (const h of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(h);
    if (value) headers.set(h, value);
  }
  headers.set("Content-Type", file.mimeType || upstream.headers.get("content-type") || "application/octet-stream");
  headers.set("Content-Disposition", disposition);
  // Private working documents: let the browser reuse bytes within a session,
  // never persist them long-term.
  headers.set("Cache-Control", "private, no-store");

  await recordDownload();

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
