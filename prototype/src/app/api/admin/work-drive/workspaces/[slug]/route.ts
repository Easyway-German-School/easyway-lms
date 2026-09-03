import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { workspaceAccess } from "@/lib/work-drive/workspaces";
import { logFileActivity } from "@/lib/work-drive/files";

export const dynamic = "force-dynamic";

const MEMBER_SELECT = { select: { userId: true, role: true } } as const;

async function loadWorkspace(slug: string) {
  return prisma.workspace.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      icon: true,
      color: true,
      kind: true,
      visibility: true,
      branchId: true,
      archivedAt: true,
      storageUsedBytes: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
      members: MEMBER_SELECT,
    },
  });
}

/**
 * GET — a workspace with the folders it contains, the files in one folder
 * (`?folderId=` or the root), and its recent activity. The folder list is flat;
 * the client assembles the tree from `parentId`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const { slug } = await params;
  const workspace = await loadWorkspace(slug);
  if (!workspace) return NextResponse.json({ error: "No such workspace." }, { status: 404 });

  const access = workspaceAccess(workspace, gate.admin);
  if (!access.canView) return NextResponse.json({ error: "Not your workspace." }, { status: 403 });

  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId") || null;

  const [folders, files, activity] = await Promise.all([
    prisma.driveFolder.findMany({
      where: { workspaceId: workspace.id, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, parentId: true, path: true },
    }),
    prisma.driveFile.findMany({
      where: { workspaceId: workspace.id, folderId, deletedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        mimeType: true,
        sizeBytes: true,
        kind: true,
        createdById: true,
        lastModifiedById: true,
        createdAt: true,
        updatedAt: true,
        currentVersion: { select: { versionNumber: true } },
      },
    }),
    prisma.fileActivity.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, action: true, actorId: true, fileId: true, meta: true, createdAt: true },
    }),
  ]);

  return NextResponse.json({
    workspace: {
      ...workspace,
      storageUsedBytes: Number(workspace.storageUsedBytes),
      members: undefined,
    },
    access,
    folderId,
    folders,
    files: files.map((f) => ({
      ...f,
      sizeBytes: Number(f.sizeBytes),
      version: f.currentVersion?.versionNumber ?? 1,
      currentVersion: undefined,
    })),
    activity,
  });
}

/** PATCH — rename, re-describe, or archive/unarchive. Editors only. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const { slug } = await params;
  const workspace = await loadWorkspace(slug);
  if (!workspace) return NextResponse.json({ error: "No such workspace." }, { status: 404 });

  const access = workspaceAccess(workspace, gate.admin);
  if (!access.canEdit) return NextResponse.json({ error: "You can view this workspace but not change it." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const data: Record<string, unknown> = {};

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > 120) {
      return NextResponse.json({ error: "The name must be 1–120 characters." }, { status: 400 });
    }
    data.name = name;
  }
  if (typeof body?.description === "string") data.description = body.description.trim().slice(0, 400) || null;
  if (typeof body?.icon === "string") data.icon = body.icon.trim().slice(0, 40) || "folder";
  if (typeof body?.color === "string") data.color = body.color.trim().slice(0, 24) || "slate";
  if (typeof body?.archived === "boolean") data.archivedAt = body.archived ? new Date() : null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  await prisma.workspace.update({ where: { id: workspace.id }, data });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE — soft-delete the workspace. The Prisma guard rewrites this into an
 * `update` setting `deletedAt`, so nothing is actually removed; the files it
 * holds go with it and a super admin can restore the lot from the security
 * page. Owner or an unrestricted admin only.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const { slug } = await params;
  const workspace = await loadWorkspace(slug);
  if (!workspace) return NextResponse.json({ error: "No such workspace." }, { status: 404 });

  const access = workspaceAccess(workspace, gate.admin);
  const isOwner = access.memberRole === "owner" || gate.admin.branchIds === null || workspace.createdById === gate.admin.userId;
  if (!isOwner) {
    return NextResponse.json({ error: "Only a workspace owner can delete it." }, { status: 403 });
  }

  await prisma.workspace.delete({ where: { id: workspace.id } });
  await logFileActivity({
    workspaceId: workspace.id,
    actorId: gate.admin.userId,
    action: "deleted",
    meta: { workspace: workspace.name },
  });
  return NextResponse.json({ ok: true });
}
