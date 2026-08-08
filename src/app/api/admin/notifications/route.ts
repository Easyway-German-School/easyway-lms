import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminHasCapability } from "@/lib/admin-roles";
import { requireTenantSession, tenantScopeForNotification } from "@/lib/tenant-access";

async function isAdmin(userId: string) {
  // Admin AND cleared for this area — see src/lib/admin-roles.ts.
  return adminHasCapability(userId, "emails");
}

export async function GET() {
  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const where = tenantScopeForNotification(auth.tenantId);

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      student: {
        include: { user: true },
      },
      branch: true,
    },
  });

  return NextResponse.json({ notifications });
}

export async function POST(request: Request) {
  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const channel = typeof body.channel === "string" ? body.channel : "email";
  const studentId = typeof body.studentId === "string" && body.studentId.trim() ? body.studentId : null;
  const branchId = typeof body.branchId === "string" && body.branchId.trim() ? body.branchId : null;
  const level = typeof body.level === "string" && body.level.trim() ? body.level : null;
  const status = typeof body.status === "string" ? body.status : "pending";

  if (!title || !message) {
    return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
  }

  try {
    if (auth.tenantId && branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { tenantId: true } });
      if (!branch || branch.tenantId !== auth.tenantId) {
        return NextResponse.json({ error: "Branch not found" }, { status: 404 });
      }
    }

    if (auth.tenantId && studentId) {
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: { user: { select: { tenantId: true } } },
      });
      if (!student || student.user.tenantId !== auth.tenantId) {
        return NextResponse.json({ error: "Student not found" }, { status: 404 });
      }
    }

    const notification = await prisma.notification.create({
      data: {
        title,
        message,
        channel,
        studentId,
        branchId,
        level,
        status,
      },
    });

    return NextResponse.json({ notification }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Unable to create notification", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
