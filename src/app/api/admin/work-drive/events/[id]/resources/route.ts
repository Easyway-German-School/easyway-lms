import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { canEditEvent } from "@/lib/work-drive/events";
import { fileAccessFor } from "@/lib/work-drive/workspaces";

export const dynamic = "force-dynamic";

const EVT_SELECT = {
  id: true,
  createdById: true,
  workspace: { select: { members: { select: { userId: true, role: true } } } },
} as const;

/** POST — attach a Work Drive file to the event. The admin must be able to see the file. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const event = await prisma.workEvent.findFirst({ where: { id, deletedAt: null }, select: EVT_SELECT });
  if (!event) return NextResponse.json({ error: "No such event." }, { status: 404 });
  if (!canEditEvent(event, gate.admin)) {
    return NextResponse.json({ error: "This isn't yours to edit." }, { status: 403 });
  }

  const b = await request.json().catch(() => null);
  const fileId = String(b?.fileId ?? "").trim();
  const file = await prisma.driveFile.findFirst({
    where: { id: fileId, deletedAt: null },
    select: {
      id: true,
      workspace: {
        select: { id: true, visibility: true, branchId: true, createdById: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!file) return NextResponse.json({ error: "No such file." }, { status: 404 });
  if (!(await fileAccessFor(file, gate.admin)).canView) {
    return NextResponse.json({ error: "You can't see that file." }, { status: 403 });
  }

  const resource = await prisma.eventResource.upsert({
    where: { eventId_fileId: { eventId: id, fileId } },
    create: {
      eventId: id,
      fileId,
      label: String(b?.label ?? "").trim().slice(0, 200) || null,
      visibleToAttendees: Boolean(b?.visibleToAttendees),
      tenantId: gate.session.user.tenantId ?? null,
    },
    update: {
      label: String(b?.label ?? "").trim().slice(0, 200) || null,
      visibleToAttendees: Boolean(b?.visibleToAttendees),
    },
    select: { id: true },
  });
  return NextResponse.json({ resource: { id: resource.id } }, { status: 201 });
}

/** DELETE ?resourceId= — detach a file. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const event = await prisma.workEvent.findFirst({ where: { id, deletedAt: null }, select: EVT_SELECT });
  if (!event) return NextResponse.json({ ok: true });
  if (!canEditEvent(event, gate.admin)) {
    return NextResponse.json({ error: "This isn't yours to edit." }, { status: 403 });
  }
  const resourceId = new URL(request.url).searchParams.get("resourceId") || "";
  await prisma.eventResource.deleteMany({ where: { id: resourceId, eventId: id } });
  return NextResponse.json({ ok: true });
}
