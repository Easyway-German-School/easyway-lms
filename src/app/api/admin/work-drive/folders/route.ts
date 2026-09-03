import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { workspaceAccess } from "@/lib/work-drive/workspaces";

export const dynamic = "force-dynamic";

/**
 * POST — create a folder in a workspace.
 *
 * `path` is the materialised route from the root ("/Finance/2026"), stored so
 * breadcrumbs and prefix search need no recursion. It is derived here from the
 * parent's path, never taken from the caller.
 */
export async function POST(request: NextRequest) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  if (!tenantId) return NextResponse.json({ error: "This account has no Work Drive." }, { status: 400 });

  const body = await request.json().catch(() => null);
  const workspaceSlug = String(body?.workspaceSlug ?? "").trim();
  const rawName = String(body?.name ?? "").trim();
  const parentId = body?.parentId ? String(body.parentId) : null;

  if (!workspaceSlug || !rawName) {
    return NextResponse.json({ error: "workspaceSlug and name are required." }, { status: 400 });
  }
  const name = rawName.replace(/[/\\]/g, "-").slice(0, 120);

  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceSlug, deletedAt: null },
    select: { id: true, visibility: true, branchId: true, createdById: true, members: { select: { userId: true, role: true } } },
  });
  if (!workspace) return NextResponse.json({ error: "No such workspace." }, { status: 404 });
  if (!workspaceAccess(workspace, gate.admin).canEdit) {
    return NextResponse.json({ error: "You can view this workspace but not add folders." }, { status: 403 });
  }

  let parentPath = "/";
  if (parentId) {
    const parent = await prisma.driveFolder.findFirst({
      where: { id: parentId, workspaceId: workspace.id, deletedAt: null },
      select: { path: true, name: true },
    });
    if (!parent) return NextResponse.json({ error: "That parent folder is not in this workspace." }, { status: 400 });
    parentPath = parent.path === "/" ? `/${parent.name}` : `${parent.path}/${parent.name}`;
  }

  const clash = await prisma.driveFolder.findFirst({
    where: { workspaceId: workspace.id, parentId, name, deletedAt: null },
    select: { id: true },
  });
  if (clash) return NextResponse.json({ error: "A folder with that name is already here." }, { status: 409 });

  const folder = await prisma.driveFolder.create({
    data: {
      workspaceId: workspace.id,
      parentId,
      name,
      path: parentPath,
      createdById: gate.admin.userId,
      tenantId,
    },
    select: { id: true, name: true, parentId: true, path: true },
  });

  return NextResponse.json({ folder }, { status: 201 });
}
