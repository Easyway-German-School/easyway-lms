import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    include: {
      branch: true,
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student profile not found" }, { status: 404 });
  }

  const notifications = await prisma.notification.findMany({
    where: {
      OR: [
        { studentId: student.id },
        { branchId: student.branchId },
        { level: student.level },
        {
          AND: [
            { studentId: null },
            { branchId: null },
            { level: null },
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    notifications: notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      message: notification.message,
      channel: notification.channel,
      studentId: notification.studentId,
      branchId: notification.branchId,
      level: notification.level,
      status: notification.status,
      sentAt: notification.sentAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    })),
  });
}
