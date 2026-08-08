import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

async function requireNotificationAdmin() {
  return requireCapability("emails");
}

export async function GET() {
  const gate = await requireNotificationAdmin();
  if (!gate.ok) return gate.response;

  const notifications = await prisma.notification.findMany({
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

export async function POST(request: NextRequest) {
  const gate = await requireNotificationAdmin();
  if (!gate.ok) return gate.response;

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
