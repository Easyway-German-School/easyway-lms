import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { parseQuestions } from "@/lib/assignments";

/** Tutors create and review assignments for a level (optionally one branch). */

export const dynamic = "force-dynamic";

async function requireStaff() {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, lecturer: { select: { id: true } } },
  });
  const role = String(user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return { error: NextResponse.json({ error: "Staff access required" }, { status: 403 }) };
  }
  return { lecturerId: user?.lecturer?.id ?? null };
}

export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if (auth.error) return auth.error;

  const level = req.nextUrl.searchParams.get("level");

  const assignments = await prisma.assignment.findMany({
    where: level ? { level } : {},
    orderBy: { createdAt: "desc" },
    include: {
      branch: { select: { id: true, name: true } },
      _count: { select: { submissions: true } },
      submissions: {
        where: { submittedAt: { not: null } },
        select: {
          id: true,
          score: true,
          submittedAt: true,
          student: { select: { studentCode: true, user: { select: { name: true } } } },
        },
        orderBy: { submittedAt: "desc" },
      },
    },
  });

  return NextResponse.json({ assignments });
}

export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { title, description, level, branchId, type, timeLimitMinutes, questions, dueAt } = body;

    if (!title || !level) {
      return NextResponse.json({ error: "title and level are required" }, { status: 400 });
    }

    const kind = type === "quiz" ? "quiz" : "document";
    const parsed = kind === "quiz" ? parseQuestions(questions) : [];

    if (kind === "quiz" && parsed.length === 0) {
      return NextResponse.json(
        { error: "A quiz needs at least one question with two or more options." },
        { status: 400 },
      );
    }
    // A question whose answer key is missing can never be marked right.
    if (parsed.some((q) => q.answerIndex < 0 || q.answerIndex >= q.options.length)) {
      return NextResponse.json(
        { error: "Every question needs a correct answer selected." },
        { status: 400 },
      );
    }

    const created = await prisma.assignment.create({
      data: {
        title: String(title).trim(),
        description: typeof description === "string" ? description.trim() || null : null,
        level: String(level).toUpperCase(),
        branchId: branchId || null,
        type: kind,
        timeLimitMinutes: kind === "quiz" && timeLimitMinutes ? Number(timeLimitMinutes) : null,
        questions: kind === "quiz" ? parsed : undefined,
        dueAt: dueAt ? new Date(dueAt) : null,
        lecturerId: auth.lecturerId ?? null,
      },
    });

    return NextResponse.json({ assignment: created });
  } catch (error) {
    console.error("Lecturer assignment POST failed:", error);
    return NextResponse.json({ error: "Unable to create the assignment" }, { status: 500 });
  }
}
