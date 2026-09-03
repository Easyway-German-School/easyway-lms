import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { workspaceAccess } from "@/lib/work-drive/workspaces";

export const dynamic = "force-dynamic";

const ROLES = new Set(["owner", "editor", "viewer"]);

async function load(slug: string) {
  return prisma.workspace.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      visibility: true,
      branchId: true,
      createdById: true,
      members: { select: { userId: true, role: true } },
    },
  });
}

/** GET — the workspace's members, with names. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;
  const { slug } = await params;
  const ws = await load(slug);
  if (!ws) return NextResponse.json({ error: "No such workspace." }, { status: 404 });
  if (!workspaceAccess(ws, gate.admin).canView) {
    return NextResponse.json({ error: "Not your workspace." }, { status: 403 });
  }

  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId: ws.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, role: true, createdAt: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    members: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      role: r.role,
      name: byId.get(r.userId)?.name ?? null,
      email: byId.get(r.userId)?.email ?? null,
      createdAt: r.createdAt,
    })),
  });
}

/** POST — add a staff member by email (or userId), at a role. Editors only. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;
  const { slug } = await params;
  const ws = await load(slug);
  if (!ws) return NextResponse.json({ error: "No such workspace." }, { status: 404 });
  if (!workspaceAccess(ws, gate.admin).canEdit) {
    return NextResponse.json({ error: "Only a workspace editor can add people." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const role = ROLES.has(String(body?.role)) ? String(body.role) : "viewer";
  const email = String(body?.email ?? "").trim().toLowerCase();
  const userId = String(body?.userId ?? "").trim();

  const user = userId
    ? await prisma.user.findFirst({ where: { id: userId }, select: { id: true, name: true, email: true, role: true } })
    : email
      ? await prisma.user.findFirst({ where: { email }, select: { id: true, name: true, email: true, role: true } })
      : null;

  if (!user) return NextResponse.json({ error: "No staff account with that email." }, { status: 404 });
  if (String(user.role).toLowerCase() === "student") {
    return NextResponse.json({ error: "The Work Drive is staff-only." }, { status: 400 });
  }

  const member = await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws.id, userId: user.id } },
    create: {
      workspaceId: ws.id,
      userId: user.id,
      role,
      addedById: gate.admin.userId,
      tenantId: gate.session.user.tenantId ?? null,
    },
    update: { role },
    select: { id: true, role: true },
  });

  return NextResponse.json({
    member: { id: member.id, userId: user.id, role: member.role, name: user.name, email: user.email },
  });
}

/** DELETE ?userId= — remove someone. Editors only; the last owner cannot go. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;
  const { slug } = await params;
  const ws = await load(slug);
  if (!ws) return NextResponse.json({ error: "No such workspace." }, { status: 404 });
  if (!workspaceAccess(ws, gate.admin).canEdit) {
    return NextResponse.json({ error: "Only a workspace editor can remove people." }, { status: 403 });
  }

  const userId = new URL(request.url).searchParams.get("userId") || "";
  const target = ws.members.find((m) => m.userId === userId);
  if (!target) return NextResponse.json({ ok: true });

  if (target.role === "owner" && ws.members.filter((m) => m.role === "owner").length <= 1) {
    return NextResponse.json({ error: "A workspace needs at least one owner." }, { status: 400 });
  }

  await prisma.workspaceMember.deleteMany({ where: { workspaceId: ws.id, userId } });
  return NextResponse.json({ ok: true });
}
