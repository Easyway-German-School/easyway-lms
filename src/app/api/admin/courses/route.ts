import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
async function isLecturer(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  return (user.role?.toLowerCase() === "lecturer" || user.role?.toLowerCase() === "admin");
}

export async function GET() {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;
  const session = gate.session;

  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isLecturer(session.user.id)) return NextResponse.json({ error: "Lecturer access required" }, { status: 403 });

  const pathway = await prisma.pathway.findUnique({ where: { name: "Lecturer Uploaded Courses" }, include: { courses: { orderBy: { order: 'asc' } } } });
  if (!pathway) return NextResponse.json({ courses: [] });

  const courses = (pathway.courses || []).map((c) => ({ id: c.id, title: c.title, description: c.description, level: c.level, duration: c.duration, published: c.published }));
  return NextResponse.json({ courses });
}
