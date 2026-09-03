import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { fileAccessFor } from "@/lib/work-drive/workspaces";
import { logFileActivity } from "@/lib/work-drive/files";

export const dynamic = "force-dynamic";

const FILE_SELECT = {
  id: true,
  name: true,
  folderId: true,
  sizeBytes: true,
  deletedAt: true,
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

/** PATCH — rename, move to another folder, or restore from the trash. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const file = await prisma.driveFile.findFirst({
    where: { id },
    select: FILE_SELECT,
  });
  if (!file) return NextResponse.json({ error: "No such file." }, { status: 404 });
  if (!(await fileAccessFor(file, gate.admin)).canEdit) {
    return NextResponse.json({ error: "You can view this file but not change it." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const data: Record<string, unknown> = { lastModifiedById: gate.admin.userId };
  let action: "renamed" | "moved" | "restored" | null = null;
  const meta: Record<string, unknown> = {};

  if (typeof body?.name === "string") {
    const name = body.name.trim().slice(0, 260);
    if (!name) return NextResponse.json({ error: "A file needs a name." }, { status: 400 });
    meta.from = file.name;
    meta.to = name;
    data.name = name;
    action = "renamed";
  }

  if ("folderId" in (body ?? {})) {
    const folderId = body.folderId ? String(body.folderId) : null;
    if (folderId) {
      const folder = await prisma.driveFolder.findFirst({
        where: { id: folderId, workspaceId: file.workspace.id, deletedAt: null },
        select: { id: true },
      });
      if (!folder) return NextResponse.json({ error: "That folder is not in this workspace." }, { status: 400 });
    }
    data.folderId = folderId;
    action = "moved";
    meta.fromFolder = file.folderId;
    meta.toFolder = folderId;
  }

  if (body?.restore === true) {
    if (!file.deletedAt) return NextResponse.json({ error: "That file is not in the trash." }, { status: 400 });
    data.deletedAt = null;
    action = "restored";
    // Put the bytes back on the workspace's tally.
    await prisma.workspace.update({
      where: { id: file.workspace.id },
      data: { storageUsedBytes: { increment: file.sizeBytes } },
    });
  }

  if (!action) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  await prisma.driveFile.update({ where: { id: file.id }, data });
  await logFileActivity({
    workspaceId: file.workspace.id,
    actorId: gate.admin.userId,
    action,
    fileId: file.id,
    meta,
  });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE — soft-delete (into the workspace trash). The Prisma guard turns this
 * into an `update` setting `deletedAt`; the bytes stay in the bucket and the
 * row is restorable. The workspace's storage tally drops so the quota meter
 * reflects what is live, not what is on disk.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const file = await prisma.driveFile.findFirst({ where: { id }, select: FILE_SELECT });
  if (!file) return NextResponse.json({ error: "No such file." }, { status: 404 });
  if (file.deletedAt) return NextResponse.json({ ok: true });
  if (!(await fileAccessFor(file, gate.admin)).canEdit) {
    return NextResponse.json({ error: "You can view this file but not delete it." }, { status: 403 });
  }

  await prisma.driveFile.delete({ where: { id: file.id } });
  await prisma.workspace.update({
    where: { id: file.workspace.id },
    data: { storageUsedBytes: { decrement: file.sizeBytes } },
  });
  await logFileActivity({
    workspaceId: file.workspace.id,
    actorId: gate.admin.userId,
    action: "deleted",
    fileId: file.id,
    meta: { name: file.name },
  });
  return NextResponse.json({ ok: true });
}
