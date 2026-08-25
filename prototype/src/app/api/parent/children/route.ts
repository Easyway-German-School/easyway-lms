import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id || session.user.role !== "parent") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parent = await prisma.parent.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!parent) {
    return NextResponse.json({ error: "Parent not found" }, { status: 404 });
  }

  const links = await prisma.parentStudent.findMany({
    where: { parentId: parent.id },
    orderBy: { linkedAt: "asc" },
    select: {
      student: {
        select: {
          id: true,
          studentCode: true,
          level: true,
          classType: true,
          deliveryMode: true,
          user: { select: { name: true, email: true } },
          branch: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json({
    children: links.map((l) => ({
      id: l.student.id,
      name: l.student.user.name || l.student.user.email,
      studentCode: l.student.studentCode,
      level: l.student.level,
      classType: l.student.classType,
      deliveryMode: l.student.deliveryMode,
      branchName: l.student.branch?.name ?? null,
    })),
  });
}
