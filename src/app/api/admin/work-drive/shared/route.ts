import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/**
 * GET — files shared directly with the signed-in admin (via FileShare), which
 * they would not otherwise see because they are not in the workspace. Active
 * shares only: not revoked, not expired.
 */
export async function GET() {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const now = new Date();
  const shares = await prisma.fileShare.findMany({
    where: {
      targetType: "file",
      sharedWithUserId: gate.admin.userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, targetId: true, permission: true, sharedById: true, createdAt: true },
  });
  if (shares.length === 0) return NextResponse.json({ files: [] });

  const files = await prisma.driveFile.findMany({
    where: { id: { in: shares.map((s) => s.targetId) }, deletedAt: null },
    select: {
      id: true,
      name: true,
      mimeType: true,
      sizeBytes: true,
      kind: true,
      updatedAt: true,
      workspace: { select: { name: true, slug: true } },
    },
  });
  const fileById = new Map(files.map((f) => [f.id, f]));
  const sharerIds = [...new Set(shares.map((s) => s.sharedById).filter(Boolean) as string[])];
  const sharers = await prisma.user.findMany({ where: { id: { in: sharerIds } }, select: { id: true, name: true } });
  const sharerName = new Map(sharers.map((u) => [u.id, u.name]));

  return NextResponse.json({
    files: shares
      .map((s) => {
        const f = fileById.get(s.targetId);
        if (!f) return null;
        return {
          shareId: s.id,
          id: f.id,
          name: f.name,
          kind: f.kind,
          sizeBytes: Number(f.sizeBytes),
          permission: s.permission,
          updatedAt: f.updatedAt,
          workspaceName: f.workspace.name,
          workspaceSlug: f.workspace.slug,
          sharedBy: s.sharedById ? sharerName.get(s.sharedById) ?? null : null,
        };
      })
      .filter(Boolean),
  });
}
