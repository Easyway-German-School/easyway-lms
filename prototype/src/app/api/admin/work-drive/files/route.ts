import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { keyFromUrl } from "@/lib/storage";
import { workspaceAccess } from "@/lib/work-drive/workspaces";
import { fileKindFor, logFileActivity, MAX_FILE_BYTES, WORK_DRIVE_PREFIX } from "@/lib/work-drive/files";

export const dynamic = "force-dynamic";

/**
 * POST — record a file that has already been PUT into the bucket.
 *
 * The browser gets a signed URL from /api/admin/work-drive/presign, uploads the
 * bytes straight to storage, then calls this with the metadata. Creating the
 * row here (rather than at presign time) means a signed URL that is never used
 * leaves nothing behind.
 *
 * One version row is written alongside, numbered 1, and pointed at by
 * `currentVersionId` — so the history is complete from the first upload.
 */
export async function POST(request: NextRequest) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  if (!tenantId) {
    return NextResponse.json({ error: "This account has no Work Drive." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const workspaceSlug = String(body?.workspaceSlug ?? "").trim();
  const rawName = String(body?.name ?? "").trim();
  const storageKeyRaw = String(body?.storageKey ?? body?.key ?? "").trim();
  const providedUrl = String(body?.url ?? "").trim();
  const mimeType = String(body?.mimeType ?? body?.contentType ?? "application/octet-stream").trim();
  const size = Math.max(0, Math.floor(Number(body?.size ?? 0)) || 0);
  const checksum = body?.checksum ? String(body.checksum).slice(0, 128) : null;
  const folderId = body?.folderId ? String(body.folderId) : null;

  if (!workspaceSlug || !rawName) {
    return NextResponse.json({ error: "workspaceSlug and name are required." }, { status: 400 });
  }
  if (size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "That file is over the size limit." }, { status: 413 });
  }

  // Accept either a raw key or an app URL that resolves to one. Reject anything
  // that is not under the Work Drive prefix — a client must not be able to
  // point a row at a recording or someone's passport scan.
  const storageKey = storageKeyRaw || keyFromUrl(providedUrl) || "";
  if (!storageKey || !storageKey.replace(/^\/+/, "").startsWith(`${WORK_DRIVE_PREFIX}/`)) {
    return NextResponse.json({ error: "That upload is not a Work Drive file." }, { status: 400 });
  }

  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceSlug, deletedAt: null },
    select: { id: true, visibility: true, branchId: true, createdById: true, members: { select: { userId: true, role: true } } },
  });
  if (!workspace) return NextResponse.json({ error: "No such workspace." }, { status: 404 });
  if (!workspaceAccess(workspace, gate.admin).canEdit) {
    return NextResponse.json({ error: "You can view this workspace but not add to it." }, { status: 403 });
  }

  if (folderId) {
    const folder = await prisma.driveFolder.findFirst({
      where: { id: folderId, workspaceId: workspace.id, deletedAt: null },
      select: { id: true },
    });
    if (!folder) return NextResponse.json({ error: "That folder is not in this workspace." }, { status: 400 });
  }

  const name = rawName.slice(0, 260);
  const kind = fileKindFor(mimeType, name);

  const file = await prisma.$transaction(async (tx) => {
    const created = await tx.driveFile.create({
      data: {
        workspaceId: workspace.id,
        folderId,
        name,
        mimeType,
        sizeBytes: BigInt(size),
        storageKey: storageKey.replace(/^\/+/, ""),
        checksum,
        kind,
        createdById: gate.admin.userId,
        lastModifiedById: gate.admin.userId,
        tenantId,
      },
      select: { id: true },
    });

    const version = await tx.driveFileVersion.create({
      data: {
        fileId: created.id,
        versionNumber: 1,
        storageKey: storageKey.replace(/^\/+/, ""),
        sizeBytes: BigInt(size),
        checksum,
        uploadedById: gate.admin.userId,
        tenantId,
      },
      select: { id: true },
    });

    await tx.driveFile.update({ where: { id: created.id }, data: { currentVersionId: version.id } });
    await tx.workspace.update({
      where: { id: workspace.id },
      data: { storageUsedBytes: { increment: BigInt(size) } },
    });

    return created;
  });

  await logFileActivity({
    workspaceId: workspace.id,
    actorId: gate.admin.userId,
    action: "uploaded",
    fileId: file.id,
    folderId,
    meta: { name, size },
  });

  return NextResponse.json({ file: { id: file.id, name, kind, sizeBytes: size } }, { status: 201 });
}
