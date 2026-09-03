import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { keyFromUrl } from "@/lib/storage";
import { fileAccessFor } from "@/lib/work-drive/workspaces";
import { fileKindFor, logFileActivity, MAX_FILE_BYTES, WORK_DRIVE_PREFIX } from "@/lib/work-drive/files";
import { indexDriveFile } from "@/lib/work-drive/index-file";

export const dynamic = "force-dynamic";

const FILE_SELECT = {
  id: true,
  name: true,
  sizeBytes: true,
  workspace: {
    select: {
      id: true,
      slug: true,
      visibility: true,
      branchId: true,
      createdById: true,
      members: { select: { userId: true, role: true } },
    },
  },
} as const;

/** GET — every version of the file, newest first. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const file = await prisma.driveFile.findFirst({ where: { id, deletedAt: null }, select: FILE_SELECT });
  if (!file) return NextResponse.json({ error: "No such file." }, { status: 404 });
  if (!(await fileAccessFor(file, gate.admin)).canView) {
    return NextResponse.json({ error: "Not your file." }, { status: 403 });
  }

  const rows = await prisma.driveFileVersion.findMany({
    where: { fileId: id },
    orderBy: { versionNumber: "desc" },
    select: { id: true, versionNumber: true, sizeBytes: true, note: true, uploadedById: true, createdAt: true },
  });
  const uploaderIds = [...new Set(rows.map((r) => r.uploadedById).filter(Boolean) as string[])];
  const uploaders = await prisma.user.findMany({
    where: { id: { in: uploaderIds } },
    select: { id: true, name: true },
  });
  const byId = new Map(uploaders.map((u) => [u.id, u.name]));

  const currentId = (
    await prisma.driveFile.findUnique({ where: { id }, select: { currentVersionId: true } })
  )?.currentVersionId;

  return NextResponse.json({
    versions: rows.map((r) => ({
      ...r,
      sizeBytes: Number(r.sizeBytes),
      uploaderName: r.uploadedById ? byId.get(r.uploadedById) ?? null : null,
      current: r.id === currentId,
    })),
  });
}

/**
 * POST — record a new version. The bytes are already in the bucket (same
 * presign route as a first upload). The file's `storageKey`, `sizeBytes` and
 * `mimeType` move to the new version; the old one stays as history.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const file = await prisma.driveFile.findFirst({ where: { id, deletedAt: null }, select: FILE_SELECT });
  if (!file) return NextResponse.json({ error: "No such file." }, { status: 404 });
  if (!(await fileAccessFor(file, gate.admin)).canEdit) {
    return NextResponse.json({ error: "You need edit access to add a version." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const storageKeyRaw = String(body?.storageKey ?? body?.key ?? "").trim();
  const providedUrl = String(body?.url ?? "").trim();
  const mimeType = String(body?.mimeType ?? body?.contentType ?? "application/octet-stream").trim();
  const size = Math.max(0, Math.floor(Number(body?.size ?? 0)) || 0);
  const checksum = body?.checksum ? String(body.checksum).slice(0, 128) : null;
  const note = body?.note ? String(body.note).trim().slice(0, 300) : null;

  if (size > MAX_FILE_BYTES) return NextResponse.json({ error: "That file is over the size limit." }, { status: 413 });

  const storageKey = (storageKeyRaw || keyFromUrl(providedUrl) || "").replace(/^\/+/, "");
  if (!storageKey || !storageKey.startsWith(`${WORK_DRIVE_PREFIX}/`)) {
    return NextResponse.json({ error: "That upload is not a Work Drive file." }, { status: 400 });
  }

  const last = await prisma.driveFileVersion.findFirst({
    where: { fileId: id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const nextNumber = (last?.versionNumber ?? 0) + 1;
  const delta = BigInt(size) - file.sizeBytes;

  await prisma.$transaction(async (tx) => {
    const version = await tx.driveFileVersion.create({
      data: {
        fileId: id,
        versionNumber: nextNumber,
        storageKey,
        sizeBytes: BigInt(size),
        checksum,
        uploadedById: gate.admin.userId,
        note,
        tenantId: gate.session.user.tenantId ?? null,
      },
      select: { id: true },
    });
    await tx.driveFile.update({
      where: { id },
      data: {
        storageKey,
        sizeBytes: BigInt(size),
        mimeType,
        kind: fileKindFor(mimeType, file.name),
        checksum,
        currentVersionId: version.id,
        lastModifiedById: gate.admin.userId,
        textContent: null, // re-indexed below
      },
    });
    await tx.workspace.update({
      where: { id: file.workspace.id },
      data: { storageUsedBytes: { increment: delta } },
    });
  });

  await logFileActivity({
    workspaceId: file.workspace.id,
    actorId: gate.admin.userId,
    action: "new_version",
    fileId: id,
    meta: { name: file.name, version: nextNumber, note },
  });
  after(() => indexDriveFile(id));

  return NextResponse.json({ version: nextNumber }, { status: 201 });
}
