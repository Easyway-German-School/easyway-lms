import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { getFile, storageConfigured } from "@/lib/storage";
import { fileAccessFor } from "@/lib/work-drive/workspaces";
import { logFileActivity, WORK_DRIVE_PREFIX } from "@/lib/work-drive/files";

export const dynamic = "force-dynamic";

/**
 * Streams a Work Drive file out of the private bucket.
 *
 * Unlike /api/files, this checks the `work_drive` capability AND that the
 * caller can see the workspace the file lives in — a student who guessed the
 * object key gets a 403, not the school's finance spreadsheet.
 *
 * `?inline=1` serves it for viewing in the browser (a PDF, an image); the
 * default is `attachment`, i.e. download.
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
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const safeName = file.name.replace(/["\\\r\n]/g, "_");
  headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${safeName}"`);
  // Private working documents: let the browser reuse bytes within a session,
  // never persist them long-term.
  headers.set("Cache-Control", "private, no-store");

  // Only bill the activity feed for a real (non-range) fetch — a video scrub
  // fires dozens of range requests and none of them is "someone downloaded it".
  if (!request.headers.get("range")) {
    await logFileActivity({
      workspaceId: file.workspace.id,
      actorId: gate.admin.userId,
      action: "downloaded",
      fileId: file.id,
      meta: { name: file.name },
    });
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
