import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, deliveryMode: true, level: true, classType: true, user: { select: { tenantId: true } } },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (student.deliveryMode !== "online" || student.classType === "private") return NextResponse.json({ missed: [], recordings: [], enabled: false });

  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const [missed, recordings] = await Promise.all([
    prisma.attendance.findMany({ where: { studentId: student.id, date: { gte: since }, present: false }, orderBy: { date: "desc" }, take: 12, select: { date: true, status: true, notes: true } }),
    prisma.material.findMany({ where: { kind: "recording", level: student.level, tenantId: student.user.tenantId }, orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }], take: 12, select: { id: true, title: true, description: true, recordedAt: true, createdAt: true } }),
  ]);

  return NextResponse.json({
    enabled: true,
    missed: missed.map((row) => ({ date: row.date, status: row.status, notes: row.notes })),
    recordings: recordings.map((row) => ({ id: row.id, title: row.title, description: row.description, recordedAt: row.recordedAt ?? row.createdAt })),
    action: missed.length ? "Review a recording, complete one lesson, then message your tutor about the missed class." : null,
  });
}
