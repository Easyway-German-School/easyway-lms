import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, type AdminContext } from "@/lib/admin-roles";
import { canEditEvent } from "@/lib/work-drive/events";

export const dynamic = "force-dynamic";

const EVT_SELECT = {
  id: true,
  createdById: true,
  workspace: { select: { members: { select: { userId: true, role: true } } } },
} as const;

async function guard(id: string, admin: AdminContext) {
  const event = await prisma.workEvent.findFirst({ where: { id, deletedAt: null }, select: EVT_SELECT });
  if (!event) return { error: NextResponse.json({ error: "No such event." }, { status: 404 }) };
  if (!canEditEvent(event, admin)) {
    return { error: NextResponse.json({ error: "This isn't yours to edit." }, { status: 403 }) };
  }
  return { error: null as null };
}

/** POST — add a planning checklist item. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const g = await guard(id, gate.admin);
  if (g.error) return g.error;

  const b = await request.json().catch(() => null);
  const title = String(b?.title ?? "").trim().slice(0, 300);
  if (!title) return NextResponse.json({ error: "The task needs a title." }, { status: 400 });

  const last = await prisma.eventTask.findFirst({
    where: { eventId: id, deletedAt: null },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const assigneeId = b?.assigneeEmail
    ? (await prisma.user.findFirst({ where: { email: String(b.assigneeEmail).toLowerCase() }, select: { id: true } }))?.id ?? null
    : null;

  const task = await prisma.eventTask.create({
    data: {
      eventId: id,
      title,
      assigneeId,
      dueAt: b?.dueAt ? new Date(b.dueAt) : null,
      order: (last?.order ?? 0) + 1,
      tenantId: gate.session.user.tenantId ?? null,
    },
    select: { id: true, title: true, done: true, order: true },
  });
  return NextResponse.json({ task }, { status: 201 });
}

/** PATCH ?taskId= — toggle done or edit the title/due date. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const g = await guard(id, gate.admin);
  if (g.error) return g.error;

  const b = await request.json().catch(() => null);
  const taskId = String(b?.taskId ?? "").trim();
  const task = await prisma.eventTask.findFirst({ where: { id: taskId, eventId: id, deletedAt: null }, select: { id: true } });
  if (!task) return NextResponse.json({ error: "No such task." }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof b?.title === "string" && b.title.trim()) data.title = b.title.trim().slice(0, 300);
  if (b?.dueAt !== undefined) data.dueAt = b.dueAt ? new Date(b.dueAt) : null;
  if (typeof b?.done === "boolean") {
    data.done = b.done;
    data.doneAt = b.done ? new Date() : null;
    data.doneById = b.done ? gate.admin.userId : null;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  await prisma.eventTask.update({ where: { id: taskId }, data });
  return NextResponse.json({ ok: true });
}

/** DELETE ?taskId= */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const g = await guard(id, gate.admin);
  if (g.error) return g.error;
  const taskId = new URL(request.url).searchParams.get("taskId") || "";
  await prisma.eventTask.deleteMany({ where: { id: taskId, eventId: id } });
  return NextResponse.json({ ok: true });
}
