import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { workDriveEnabled } from "@/lib/work-drive/settings";
import {
  normalizeKind,
  normalizeVisibility,
  uniqueWorkspaceSlug,
  visibleWorkspacesWhere,
} from "@/lib/work-drive/workspaces";

export const dynamic = "force-dynamic";

/** GET — the workspaces this admin can open, newest first. */
export async function GET() {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  if (!(await workDriveEnabled(tenantId))) {
    return NextResponse.json({ enabled: false, workspaces: [] });
  }

  const rows = await prisma.workspace.findMany({
    where: {
      deletedAt: null,
      archivedAt: null,
      ...visibleWorkspacesWhere(gate.admin),
    },
    orderBy: { updatedAt: "desc" },
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
      storageUsedBytes: true,
      updatedAt: true,
      createdById: true,
      _count: { select: { files: { where: { deletedAt: null } }, members: true } },
    },
  });

  return NextResponse.json({
    enabled: true,
    workspaces: rows.map((w) => ({
      ...w,
      storageUsedBytes: Number(w.storageUsedBytes),
      fileCount: w._count.files,
      memberCount: w._count.members,
      _count: undefined,
    })),
  });
}

/** POST — create a workspace. The creator is its first owner. */
export async function POST(request: NextRequest) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  if (!tenantId) {
    return NextResponse.json(
      { error: "This account is not attached to a school, so it has no Work Drive." },
      { status: 400 },
    );
  }
  if (!(await workDriveEnabled(tenantId))) {
    return NextResponse.json({ error: "The Work Drive is not switched on for this school." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  if (!name || name.length > 120) {
    return NextResponse.json({ error: "Give the workspace a name (up to 120 characters)." }, { status: 400 });
  }

  const visibility = normalizeVisibility(body?.visibility);
  const kind = normalizeKind(body?.kind);
  const branchId = visibility === "branch" ? (String(body?.branchId ?? "").trim() || null) : null;
  if (visibility === "branch" && !branchId) {
    return NextResponse.json({ error: "Pick a branch for a branch-visible workspace." }, { status: 400 });
  }

  const icon = String(body?.icon ?? "folder").trim().slice(0, 40) || "folder";
  const color = String(body?.color ?? "slate").trim().slice(0, 24) || "slate";
  const description = String(body?.description ?? "").trim().slice(0, 400) || null;

  const slug = await uniqueWorkspaceSlug(name);

  const workspace = await prisma.workspace.create({
    data: {
      name,
      slug,
      description,
      icon,
      color,
      kind,
      visibility,
      branchId,
      createdById: gate.admin.userId,
      tenantId,
      members: {
        create: { userId: gate.admin.userId, role: "owner", addedById: gate.admin.userId, tenantId },
      },
    },
    select: { id: true, slug: true, name: true },
  });

  // The security record of "who made this" is the AuditLog, written by the
  // admin gate. The workspace activity feed is file-scoped and starts empty.
  return NextResponse.json({ workspace }, { status: 201 });
}
