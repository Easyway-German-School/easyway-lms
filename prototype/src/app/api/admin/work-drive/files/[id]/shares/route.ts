import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { fileAccessFor } from "@/lib/work-drive/workspaces";
import { logFileActivity } from "@/lib/work-drive/files";
import { notify, KIND } from "@/lib/notify";

export const dynamic = "force-dynamic";

const FILE_SELECT = {
  id: true,
  name: true,
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

/** GET — who this file is shared with (beyond the workspace). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const file = await prisma.driveFile.findFirst({ where: { id, deletedAt: null }, select: FILE_SELECT });
  if (!file) return NextResponse.json({ error: "No such file." }, { status: 404 });
  if (!(await fileAccessFor(file, gate.admin)).canView) {
    return NextResponse.json({ error: "Not your file." }, { status: 403 });
  }

  const shares = await prisma.fileShare.findMany({
    where: { targetType: "file", targetId: id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, sharedWithUserId: true, permission: true, expiresAt: true, createdAt: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: shares.map((s) => s.sharedWithUserId) } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    shares: shares.map((s) => ({
      ...s,
      name: byId.get(s.sharedWithUserId)?.name ?? null,
      email: byId.get(s.sharedWithUserId)?.email ?? null,
    })),
  });
}

/** POST — share the file with a named staff member at view/edit. Editors only. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const file = await prisma.driveFile.findFirst({ where: { id, deletedAt: null }, select: FILE_SELECT });
  if (!file) return NextResponse.json({ error: "No such file." }, { status: 404 });
  if (!(await fileAccessFor(file, gate.admin)).canEdit) {
    return NextResponse.json({ error: "You need edit access to share this file." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const permission = String(body?.permission) === "edit" ? "edit" : "view";
  if (!email) return NextResponse.json({ error: "Who should it go to?" }, { status: 400 });

  const target = await prisma.user.findFirst({
    where: { email },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "No staff account with that email." }, { status: 404 });
  if (String(target.role).toLowerCase() === "student") {
    return NextResponse.json({ error: "The Work Drive is staff-only." }, { status: 400 });
  }
  if (target.id === gate.admin.userId) {
    return NextResponse.json({ error: "You already have this file." }, { status: 400 });
  }

  const share = await prisma.fileShare.upsert({
    where: {
      targetType_targetId_sharedWithUserId: {
        targetType: "file",
        targetId: id,
        sharedWithUserId: target.id,
      },
    },
    create: {
      targetType: "file",
      targetId: id,
      sharedById: gate.admin.userId,
      sharedWithUserId: target.id,
      permission,
      tenantId: gate.session.user.tenantId ?? null,
    },
    update: { permission, revokedAt: null, sharedById: gate.admin.userId },
    select: { id: true, permission: true },
  });

  await logFileActivity({
    workspaceId: file.workspace.id,
    actorId: gate.admin.userId,
    action: "shared",
    fileId: id,
    meta: { name: file.name, to: target.email, permission },
  });

  await notify({
    to: { userIds: [target.id] },
    title: `A file was shared with you`,
    message: `"${file.name}" — you can ${permission === "edit" ? "edit" : "view"} it.`,
    kind: KIND.general,
    link: `/admin/work-drive/shared`,
    senderId: gate.admin.userId,
  }).catch((e) => console.error("work-drive: share notify failed", e));

  return NextResponse.json({
    share: { id: share.id, permission: share.permission, name: target.name, email: target.email },
  });
}

/** DELETE ?shareId= — revoke a share. Editors only. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const file = await prisma.driveFile.findFirst({ where: { id, deletedAt: null }, select: FILE_SELECT });
  if (!file) return NextResponse.json({ error: "No such file." }, { status: 404 });
  if (!(await fileAccessFor(file, gate.admin)).canEdit) {
    return NextResponse.json({ error: "You need edit access to change sharing." }, { status: 403 });
  }

  const shareId = new URL(request.url).searchParams.get("shareId") || "";
  await prisma.fileShare.updateMany({
    where: { id: shareId, targetType: "file", targetId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
