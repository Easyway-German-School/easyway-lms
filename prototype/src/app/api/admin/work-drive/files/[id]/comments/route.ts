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

/** GET — the comment thread on a file, oldest first. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const file = await prisma.driveFile.findFirst({ where: { id, deletedAt: null }, select: FILE_SELECT });
  if (!file) return NextResponse.json({ error: "No such file." }, { status: 404 });
  if (!(await fileAccessFor(file, gate.admin)).canView) {
    return NextResponse.json({ error: "Not your file." }, { status: 403 });
  }

  const comments = await prisma.fileComment.findMany({
    where: { fileId: id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, authorId: true, createdAt: true },
  });
  const authorIds = [...new Set(comments.map((c) => c.authorId).filter(Boolean) as string[])];
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  const byId = new Map(authors.map((a) => [a.id, a.name]));

  return NextResponse.json({
    comments: comments.map((c) => ({ ...c, authorName: c.authorId ? byId.get(c.authorId) ?? null : null })),
  });
}

/** POST — add a comment. Anyone who can view the file may comment. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const file = await prisma.driveFile.findFirst({ where: { id, deletedAt: null }, select: FILE_SELECT });
  if (!file) return NextResponse.json({ error: "No such file." }, { status: 404 });
  if (!(await fileAccessFor(file, gate.admin)).canView) {
    return NextResponse.json({ error: "Not your file." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const text = String(body?.body ?? "").trim().slice(0, 4000);
  if (!text) return NextResponse.json({ error: "Say something." }, { status: 400 });

  const comment = await prisma.fileComment.create({
    data: { fileId: id, authorId: gate.admin.userId, body: text, tenantId: gate.session.user.tenantId ?? null },
    select: { id: true, body: true, authorId: true, createdAt: true },
  });

  await logFileActivity({
    workspaceId: file.workspace.id,
    actorId: gate.admin.userId,
    action: "commented",
    fileId: id,
    meta: { name: file.name },
  });

  // Tell the other people on the file — workspace members and anyone it is
  // shared with — but not the commenter.
  const shareRecipients = await prisma.fileShare.findMany({
    where: { targetType: "file", targetId: id, revokedAt: null },
    select: { sharedWithUserId: true },
  });
  const recipients = [
    ...file.workspace.members.map((m) => m.userId),
    ...shareRecipients.map((s) => s.sharedWithUserId),
  ].filter((uid) => uid && uid !== gate.admin.userId);

  if (recipients.length > 0) {
    await notify({
      to: { userIds: [...new Set(recipients)] },
      title: `New comment on "${file.name}"`,
      message: text.length > 140 ? `${text.slice(0, 140)}…` : text,
      kind: KIND.general,
      link: `/admin/work-drive/${file.workspace.slug}`,
      senderId: gate.admin.userId,
    }).catch((e) => console.error("work-drive: comment notify failed", e));
  }

  return NextResponse.json({ comment }, { status: 201 });
}
