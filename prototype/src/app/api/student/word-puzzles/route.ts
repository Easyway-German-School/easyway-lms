import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dailySeed, type PuzzleWord } from "@/lib/word-puzzles";

export const dynamic = "force-dynamic";

type PuzzleProgress = {
  wortbau?: { day: string; score: number; at: string };
  wortsuche?: { day: string; found: number; at: string };
};

function readProgress(planJson: string | null | undefined): PuzzleProgress {
  if (!planJson) return {};
  try {
    const plan = JSON.parse(planJson) as Record<string, unknown>;
    const raw = plan.wordPuzzles;
    if (!raw || typeof raw !== "object") return {};
    return raw as PuzzleProgress;
  } catch {
    return {};
  }
}

function asPuzzleWords(raw: unknown): PuzzleWord[] {
  if (!Array.isArray(raw)) return [];
  const out: PuzzleWord[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const de = String(item.de ?? item.word ?? "").trim();
    const en = String(item.en ?? item.gloss ?? "").trim();
    if (!de) continue;
    // Prefer single nouns for Scrabble/search (skip multi-word phrases).
    const head = de.split(/\s+/)[0] ?? de;
    if (head.length < 3 || head.length > 12) continue;
    out.push({
      word: head,
      gloss: en || "from your materials",
      article: String(item.article ?? "").trim(),
    });
  }
  return out;
}

async function materialWordsForStudent(_studentId: string, level: string | null): Promise<PuzzleWord[]> {
  const levelFilter = level
    ? { OR: [{ level }, { course: { level } }] }
    : undefined;

  const [transcripts, materials] = await Promise.all([
    prisma.classTranscript.findMany({
      where: {
        status: "ready",
        ...(levelFilter
          ? { classRecording: { material: levelFilter } }
          : {}),
      },
      select: { vocabulary: true },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }).catch(() => [] as Array<{ vocabulary: unknown }>),
    prisma.material.findMany({
      where: {
        ...(levelFilter ?? {}),
        questsReviewedAt: { not: null },
      },
      select: { aiNotes: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }).catch(() => [] as Array<{ aiNotes: unknown }>),
  ]);

  const collected: PuzzleWord[] = [];
  for (const row of transcripts) {
    if (row.vocabulary) collected.push(...asPuzzleWords(row.vocabulary));
  }
  for (const material of materials) {
    const notes = material.aiNotes;
    if (notes && typeof notes === "object") {
      const vocab = (notes as { vocabulary?: unknown }).vocabulary;
      collected.push(...asPuzzleWords(vocab));
    }
  }

  const unique = new Map<string, PuzzleWord>();
  for (const word of collected) {
    const key = word.word.toUpperCase();
    if (!unique.has(key)) unique.set(key, { ...word, word: key });
    if (unique.size >= 40) break;
  }
  return [...unique.values()];
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      level: true,
      personalizedPlan: { select: { plan: true } },
    },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const day = dailySeed();
  const progress = readProgress(student.personalizedPlan?.plan);
  const materialWords = await materialWordsForStudent(student.id, student.level);

  return NextResponse.json({
    level: student.level,
    day,
    materialWords,
    completed: {
      wortbau: progress.wortbau?.day === day,
      wortsuche: progress.wortsuche?.day === day,
    },
    last: {
      wortbau: progress.wortbau ?? null,
      wortsuche: progress.wortsuche ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const game = body?.game === "wortsuche" ? "wortsuche" : body?.game === "wortbau" ? "wortbau" : null;
  if (!game) return NextResponse.json({ error: "Unknown game" }, { status: 400 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, personalizedPlan: { select: { plan: true } } },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const day = dailySeed();
  let plan: Record<string, unknown> = {};
  try {
    plan = student.personalizedPlan?.plan
      ? (JSON.parse(student.personalizedPlan.plan) as Record<string, unknown>)
      : {};
  } catch {
    plan = {};
  }

  const progress = readProgress(student.personalizedPlan?.plan);
  if (game === "wortbau") {
    progress.wortbau = {
      day,
      score: Math.max(0, Number(body?.score) || 0),
      at: new Date().toISOString(),
    };
  } else {
    progress.wortsuche = {
      day,
      found: Math.max(0, Number(body?.found) || 0),
      at: new Date().toISOString(),
    };
  }
  plan.wordPuzzles = progress;

  await prisma.personalizedPlan.upsert({
    where: { studentId: student.id },
    update: { plan: JSON.stringify(plan) },
    create: { studentId: student.id, plan: JSON.stringify(plan) },
  });

  return NextResponse.json({ ok: true, day, progress });
}
