import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      classType: true,
      level: true,
      pathway: true,
      user: { select: { name: true } },
      grades: { orderBy: { createdAt: "desc" }, take: 80, select: { type: true, score: true, feedback: true, createdAt: true } },
      attendances: { orderBy: { date: "desc" }, take: 120, select: { date: true, present: true, status: true } },
      privateClasses: { orderBy: { scheduledAt: "desc" }, take: 40, select: { scheduledAt: true, status: true, topic: true, durationMinutes: true } },
      sessionNotes: { orderBy: { createdAt: "desc" }, take: 20, select: { summary: true, createdAt: true, privateClass: { select: { topic: true, scheduledAt: true } } } },
    },
  });

  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (student.classType !== "private") return NextResponse.json({ error: "Private report unavailable" }, { status: 403 });

  const bySkill = new Map<string, number[]>();
  for (const grade of student.grades) bySkill.set(grade.type, [...(bySkill.get(grade.type) ?? []), grade.score]);
  const skills = [...bySkill.entries()].map(([skill, scores]) => ({
    skill,
    average: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    attempts: scores.length,
  })).sort((a, b) => a.average - b.average);
  const held = student.attendances.length;
  const present = student.attendances.filter((row) => row.present || row.status === "late").length;
  const completedSessions = student.privateClasses.filter((row) => row.status === "completed").length;
  const nextSession = student.privateClasses.find((row) => row.status === "scheduled") ?? null;

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    student: student.user.name ?? "Private student",
    level: student.level,
    pathway: student.pathway,
    skills,
    attendance: { held, present, rate: held ? Math.round((present / held) * 100) : null },
    sessions: { completed: completedSessions, total: student.privateClasses.length, next: nextSession },
    notes: student.sessionNotes.map((note) => ({ summary: note.summary, topic: note.privateClass?.topic ?? null, date: note.privateClass?.scheduledAt ?? note.createdAt })),
    feedback: student.grades.filter((grade) => grade.feedback).slice(0, 10).map((grade) => ({ type: grade.type, feedback: grade.feedback, score: grade.score, date: grade.createdAt })),
    focus: skills[0]?.skill ?? "Keep building consistent practice habits",
  });
}
