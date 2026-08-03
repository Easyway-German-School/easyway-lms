import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
async function isLecturer(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  return (user.role?.toLowerCase() === "lecturer" || user.role?.toLowerCase() === "admin");
}

export async function POST(request: NextRequest) {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;

  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isLecturer(session.user.id)) return NextResponse.json({ error: "Lecturer access required" }, { status: 403 });

  const body = await request.json();
  const { courseId, title, description, order } = body;
  if (!courseId || !title) return NextResponse.json({ error: "courseId and title required" }, { status: 400 });

  try {
    const created = await prisma.module.create({
      data: {
        courseId,
        title,
        description: description || "",
        order: order || 1,
      }
    });
    return NextResponse.json({ module: created }, { status: 201 });
  } catch (error) {
    console.error("Create module error:", error);
    return NextResponse.json({ error: "Failed to create module" }, { status: 500 });
  }
}
