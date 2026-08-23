import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const REQUESTABLE_STATUSES = ["scheduled", "postponed", "requested"];

/** PATCH — a private student asks to cancel or reschedule ONE of their own sessions. Staff approve or decline it from there. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, classType: true, user: { select: { name: true } }, tutor: { select: { userId: true } } },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (student.classType !== "private") return NextResponse.json({ error: "Private students only" }, { status: 400 });

  const { id } = await params;
  const existing = await prisma.privateClass.findUnique({ where: { id } });
  if (!existing || existing.studentId !== student.id) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (!REQUESTABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "This session already has a pending request or is no longer active" }, { status: 400 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (action !== "request_cancel" && action !== "request_reschedule") {
    return NextResponse.json({ error: "action must be request_cancel or request_reschedule" }, { status: 400 });
  }

  let proposedAt: Date | null = null;
  if (action === "request_reschedule") {
    proposedAt = typeof body?.proposedAt === "string" ? new Date(body.proposedAt) : new Date("invalid");
    if (Number.isNaN(proposedAt.getTime())) {
      return NextResponse.json({ error: "Choose a valid proposed date and time" }, { status: 400 });
    }
  }

  const updated = await prisma.privateClass.update({
    where: { id },
    data: {
      status: action === "request_cancel" ? "cancel_requested" : "reschedule_requested",
      proposedAt,
    },
  });

  const studentName = student.user.name ?? "A private student";
  const message = action === "request_cancel"
    ? `${studentName} asked to cancel the session on ${existing.scheduledAt.toLocaleString()}.`
    : `${studentName} asked to move the session on ${existing.scheduledAt.toLocaleString()} to ${proposedAt!.toLocaleString()}.`;
  const title = action === "request_cancel" ? "Cancellation requested" : "Reschedule requested";

  // Same role-specific link split as every other private-class notification
  // here: admin has no lecturer identity, so it gets its own review page.
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  if (admins.length) {
    await notify({
      to: { userIds: admins.map((admin) => admin.id) },
      kind: KIND.privateClassUpdated,
      severity: "info",
      title,
      message,
      link: `/admin/schedule/private/${encodeURIComponent(student.id)}`,
      dedupeKey: `private-class-request:${updated.id}:${action}:admin`,
    });
  }
  if (student.tutor?.userId) {
    await notify({
      to: { userIds: [student.tutor.userId] },
      kind: KIND.privateClassUpdated,
      severity: "info",
      title,
      message,
      link: `/lecturer/private-classes?studentId=${encodeURIComponent(student.id)}`,
      dedupeKey: `private-class-request:${updated.id}:${action}:tutor`,
    });
  }

  return NextResponse.json({ class: updated });
}
