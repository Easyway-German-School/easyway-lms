import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await requireAuthSession();
  const role = String(session?.user?.role ?? "").toLowerCase();
  if (!session?.user?.id || (role !== "lecturer" && role !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const examId = String(body.examId ?? "");
  if (!examId) return NextResponse.json({ error: "Exam ID required" }, { status: 400 });

  const exam = await prisma.exam.findFirst({
    where: { id: examId, ...(role === "lecturer" ? { lecturer: { userId: session.user.id } } : {}) },
    select: { id: true, resultsReleased: true },
  });
  if (!exam) return NextResponse.json({ error: "Exam not found" }, { status: 404 });

  const updated = await prisma.exam.update({ where: { id: exam.id }, data: { resultsReleased: !exam.resultsReleased } });
  return NextResponse.json({ examId: updated.id, resultsReleased: updated.resultsReleased });
}